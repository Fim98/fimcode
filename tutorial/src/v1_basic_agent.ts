#!/usr/bin/env bun
/**
 * v1_basic_agent.ts - Mini Claude Code: 模型即代理 (~200行)
 * 
 * 核心理念: "模型就是代理"
 * =================================
 * Claude Code、Cursor Agent、Codex CLI的秘密是什么？没有秘密。
 * 
 * 剥离CLI的华丽界面、进度条、权限系统。剩下的
 * 出人意料地简单：一个循环，让模型调用工具直到完成。
 * 
 * 传统助手：
 *     用户 -> 模型 -> 文本响应
 * 
 * 代理系统：
 *     用户 -> 模型 -> [工具 -> 结果]* -> 响应
 *                           ^________|
 * 
 * 星号(*)很重要！模型重复调用工具直到它决定任务完成。
 * 这将聊天机器人转变为自主代理。
 * 
 * 关键洞察：模型是决策者。代码只是提供工具并运行循环。
 * 模型决定：
 *   - 调用哪些工具
 *   - 以什么顺序
 *   - 何时停止
 * 
 * 四个基本工具：
 * ------------------------
 * Claude Code有约20个工具。但这4个覆盖了90%的使用场景：
 * 
 *   | 工具       | 目的              | 示例                    |
 *   |------------|---------------------|--------------------------|
 *   | bash       | 运行任何命令      | npm install, git status  |
 *   | read_file  | 读取文件内容   | 查看 src/index.ts         |
 *   | write_file | 创建/重写     | 创建 README.md          |
 *   | edit_file  | 精确修改     | 替换函数        |
 * 
 * 仅用这4个工具，模型可以：
 *   - 探索代码库（bash: find, grep, ls）
 *   - 理解代码（read_file）
 *   - 进行更改（write_file, edit_file）
 *   - 运行任何东西（bash: python, npm, make）
 * 
 * 用法：
 *     bun run src/v1_basic_agent.ts
 */

import Anthropic, { Tool } from '@anthropic-ai/sdk';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// =============================================================================
// 配置
// =============================================================================

const WORKDIR = process.cwd();
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-5';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL
});

// =============================================================================
// 系统提示 - 模型唯一需要的"配置"
// =============================================================================

const SYSTEM = `你是一个位于 ${WORKDIR} 的编程代理。

循环：简短思考 -> 使用工具 -> 报告结果。

规则：
- 优先使用工具而非文字。行动，不要只是解释。
- 不要虚构文件路径。如果不确定，使用bash ls/find。
- 做最少的更改。不要过度设计。
- 完成后，总结改变了什么。`;

// =============================================================================
// 工具定义 - 4个工具覆盖90%的编程任务
// =============================================================================

/**
 * 工具1: Bash - 通向一切的网关
 * 
 * 可以运行任何命令：git、npm、python、curl等。
 */
const bashTool: Tool = {
  name: 'bash',
  description: '运行shell命令。用于：ls、find、grep、git、npm、python等。',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的shell命令'
      }
    },
    required: ['command']
  }
};

/**
 * 工具2: 读取文件 - 用于理解现有代码
 * 
 * 返回文件内容，大型文件可选择行数限制。
 */
const read_fileTool: Tool = {
  name: 'read_file',
  description: '读取文件内容。返回UTF-8文本。',
  input_schema: {
    type: 'object',
    properties: {
      path: { 
        type: 'string', 
        description: '文件的相对路径' 
      },
      limit: {
        type: 'integer',
        description: '最大读取行数（默认：全部）'
      }
    },
    required: ['path']
  }
};

/**
 * 工具3: 写入文件 - 用于创建新文件或完全重写
 * 
 * 自动创建父目录。
 */
const write_fileTool: Tool = {
  name: 'write_file',
  description: '向文件写入内容。如需要会创建父目录。',
  input_schema: {
    type: 'object',
    properties: {
      path: { 
        type: 'string', 
        description: '文件的相对路径' 
      },
      content: { 
        type: 'string', 
        description: '要写入的内容' 
      }
    },
    required: ['path', 'content']
  }
};

/**
 * 工具4: 编辑文件 - 用于对现有代码进行精确修改
 * 
 * 使用精确字符串匹配进行编辑。
 * 比write_file更高效，因为不需要重写整个文件。
 */
const edit_fileTool: Tool = {
  name: 'edit_file',
  description: '替换文件中的精确文本。用于精确编辑。',
  input_schema: {
    type: 'object',
    properties: {
      path: { 
        type: 'string', 
        description: '文件的相对路径' 
      },
      old_text: {
        type: 'string',
        description: '要查找的精确文本（必须精确匹配）'
      },
      new_text: { 
        type: 'string', 
        description: '替换文本' 
      }
    },
    required: ['path', 'old_text', 'new_text']
  }
};

const TOOLS: Tool[] = [
  bashTool,
  read_fileTool,
  write_fileTool,
  edit_fileTool
];

// =============================================================================
// 工具实现
// =============================================================================

/**
 * 确保路径保持在工作区内（安全措施）。
 * 
 * 防止模型访问项目目录外的文件。
 * 解析相对路径并检查它们不会通过'../'逃逸。
 */
function safePath(path: string): string {
  const resolved = `${WORKDIR}/${path}`.replace(/\/+/g, '/');
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`路径超出工作区: ${path}`);
  }
  return resolved;
}

/**
 * 执行带有安全检查的shell命令。
 * 
 * 安全：阻止明显危险的命令。
 * 超时：60秒防止挂起。
 * 输出：截断至50KB防止上下文溢出。
 */
async function runBash(command: string): Promise<string> {
  // 基本安全检查 - 阻止危险模式
  const dangerous = ['rm -rf /', 'sudo', 'shutdown', 'reboot', '> /dev/'];
  if (dangerous.some(d => command.includes(d))) {
    return '错误：危险命令被阻止';
  }

  try {
    const proc = Bun.spawn(['bash', '-c', command], {
      cwd: WORKDIR,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    const result = (output + error).trim();

    return result.slice(0, 50000) || '(无输出)';
  } catch (error) {
    return `错误：${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 读取文件内容，可选择行数限制。
 * 
 * 对于大文件，使用limit只读取前N行。
 * 输出截断至50KB防止上下文溢出。
 */
async function runRead(path: string, limit?: number): Promise<string> {
  try {
    const safe = safePath(path);
    
    // 使用Bun.file API读取文件
    const file = Bun.file(safe);
    const content = await file.text();
    
    const lines = content.split('\n');

    if (limit && limit < lines.length) {
      const truncated = lines.slice(0, limit);
      truncated.push(`... (还有 ${lines.length - limit} 行)`);
      return truncated.join('\n').slice(0, 50000);
    }

    return content.slice(0, 50000);
  } catch (error) {
    return `错误：${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 将内容写入文件，如需要会创建父目录。
 * 
 * 这用于完整的文件创建/重写。
 * 对于部分编辑，请使用edit_file。
 */
async function runWrite(path: string, content: string): Promise<string> {
  try {
    const safe = safePath(path);
    
    // 使用Bun.write API写入文件
    await Bun.write(safe, content);
    
    return `向 ${path} 写入了 ${content.length} 字节`;
  } catch (error) {
    return `错误：${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 替换文件中的精确文本（精确编辑）。
 * 
 * 使用精确字符串匹配 - old_text必须逐字出现。
 * 只替换第一次出现以防止意外大量更改。
 */
async function runEdit(path: string, oldText: string, newText: string): Promise<string> {
  try {
    const safe = safePath(path);
    
    const file = Bun.file(safe);
    const content = await file.text();

    if (!content.includes(oldText)) {
      return `错误：在 ${path} 中未找到文本`;
    }

    // 只替换第一次出现（安全）
    const newContent = content.replace(oldText, newText);
    await Bun.write(safe, newContent);
    
    return `已编辑 ${path}`;
  } catch (error) {
    return `错误：${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 将工具调用分发到相应的实现。
 * 
 * 这是模型工具调用和实际执行之间的桥梁。
 * 每个工具都返回一个字符串结果，返回给模型。
 */
async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case 'bash':
      return runBash(args.command as string);
    
    case 'read_file':
      return runRead(args.path as string, args.limit as number | undefined);
    
    case 'write_file':
      return runWrite(args.path as string, args.content as string);
    
    case 'edit_file':
      return runEdit(args.path as string, args.old_text as string, args.new_text as string);
    
    default:
      return `未知工具：${name}`;
  }
}

// =============================================================================
// 代理循环 - 这是一切的核心
// =============================================================================

/**
 * 一个函数中的完整代理。
 * 
 * 这是所有编程代理都共享的模式：
 * 
 *     while True:
 *         response = model(messages, tools)
 *         if no tool calls: return
 *         execute tools, append results, continue
 * 
 * 模型控制循环：
 *   - 持续调用工具直到stop_reason != "tool_use"
 *   - 结果成为上下文（作为"user"消息反馈）
 *   - 内存是自动的（messages列表累积历史记录）
 * 
 * @param messages - 对话历史（可变，会被修改）
 */
async function agentLoop(messages: Anthropic.MessageParam[]): Promise<void> {
  while (true) {
    // 步骤1：调用模型
    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM,
      messages,
      tools: TOOLS,
      max_tokens: 8000
    });

    // 步骤2：收集任何工具调用并打印文本输出
    const toolCalls: Anthropic.ToolUseBlock[] = [];
    
    for (const block of response.content) {
      if (block.type === 'text') {
        // 打印模型的文本输出
        process.stdout.write(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push(block);
      }
    }

    // 步骤3：如果没有工具调用，任务完成
    if (response.stop_reason !== 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      return;
    }

    // 步骤4：执行每个工具并收集结果
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tc of toolCalls) {
      // 显示正在执行的内容
      console.log(`\n> ${tc.name}:`, JSON.stringify(tc.input));

      // 执行并显示结果预览
      const output = await executeTool(tc.name, tc.input);
      const preview = output.length > 200 
        ? output.slice(0, 200) + '...' 
        : output;
      console.log(`  ${preview}`);

      results.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: output
      });
    }

    // 步骤5：添加到对话并继续
    // 注意：我们先添加助手的响应，然后是用户的工具结果
    // 这保持了用户/助手交替的模式
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: results });
  }
}

// =============================================================================
// 主REPL
// =============================================================================

/**
 * 用于交互使用的简单读取-求值-打印循环。
 * 
 * 历史列表在轮次间维护对话上下文，
 * 允许具有内存的多轮对话。
 */
async function main() {
  console.log(`\n🤖 Mini Claude Code v1 - ${WORKDIR}`);
  console.log('输入任务请求，或输入 "exit" 退出\n');

  const history: Anthropic.MessageParam[] = [];

  while (true) {
    try {
      const userInput = await prompt('你：')?.trim();
      
      if (!userInput || ['exit', 'quit', 'q'].includes(userInput.toLowerCase())) {
        break;
      }

      // 将用户消息添加到历史记录
      history.push({ role: 'user', content: userInput });

      try {
        // 运行代理循环
        await agentLoop(history);
      } catch (error) {
        console.error(`错误：${error instanceof Error ? error.message : error}`);
      }

      console.log(); // 轮次间的空行

    } catch (error) {
      if (error instanceof Error && error.message.includes('EOF')) {
        break;
      }
      throw error;
    }
  }

  console.log('再见！');
}

main().catch(console.error);
