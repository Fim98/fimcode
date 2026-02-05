#!/usr/bin/env bun
/**
 * v3_subagent.ts - Mini Claude Code: 子代理机制 (~450行)
 * 
 * 核心哲学: "分而治之，隔离上下文"
 * ==================================================
 * v2 版本增加了规划功能。但对于大型任务，如"探索代码库然后重构认证",
 * 单一代理会遇到问题:
 * 
 * 问题 - 上下文污染:
 * ----------------
 *     单一代理历史记录:
 *       [探索中...] cat file1.py -> 500 行
 *       [探索中...] cat file2.py -> 300 行
 *       ... 15 个更多文件 ...
 *       [现在重构中...] "等等，file1 包含什么内容？"
 * 
 *     模型的上下文充满了探索细节，为实际任务留下很少空间。
 *     这就是"上下文污染"。
 * 
 * 解决方案 - 带有隔离上下文的子代理:
 * ----------------------------------
 *     主代理历史记录:
 *       [任务: 探索代码库]
 *         -> 子代理探索 20 个文件 (在它自己的上下文中)
 *         -> 只返回: "认证在 src/auth/, 数据库在 src/models/"
 *       [现在用干净的上下文进行重构]
 * 
 *     每个子代理有:
 *       1. 自己的新消息历史
 *       2. 过滤的工具 (探索代理不能写入)
 *       3. 专门的系统提示
 *       4. 只向父代理返回最终摘要
 * 
 * 关键洞察:
 * ---------
 *     进程隔离 = 上下文隔离
 * 
 * 通过生成子任务，我们获得:
 *   - 主代理的干净上下文
 *   - 并行探索的可能性
 *   - 自然的任务分解
 *   - 相同的代理循环，不同的上下文
 * 
 * 代理类型注册表:
 * --------------
 *     | 类型    | 工具                | 目的                       |
 *     |---------|--------------------|----------------------------|
 *     | explore | bash, read_file    | 只读探索                   |
 *     | code    | all tools          | 完整实现访问               |
 *     | plan    | bash, read_file    | 设计而不修改               |
 * 
 * 典型流程:
 * ---------
 *     用户: "重构认证以使用 JWT"
 * 
 *     主代理:
 *       1. Task(explore): "找到所有认证相关文件"
 *          -> 子代理读取 10 个文件
 *          -> 返回: "认证在 src/auth/login.py..."
 * 
 *       2. Task(plan): "设计 JWT 迁移"
 *          -> 子代理分析结构
 *          -> 返回: "1. 添加 jwt 库 2. 创建工具..."
 * 
 *       3. Task(code): "实现 JWT 令牌"
 *          -> 子代理编写代码
 *          -> 返回: "创建了 jwt_utils.py, 更新了 login.py"
 * 
 *       4. 向用户总结更改
 * 
 * 用法：
 *     bun run src/v3_subagent.ts
 */

import Anthropic, { Tool } from '@anthropic-ai/sdk';

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
// 代理类型注册表 - 子代理机制的核心
// =============================================================================

/**
 * 代理类型配置
 */
type AgentType = 'explore' | 'code' | 'plan';

interface AgentConfig {
  description: string;
  tools: string[] | '*';  // '*' 表示所有工具
  prompt: string;
}

/**
 * 代理类型注册表
 * 
 * 每种类型有：
 * - description: 给模型的说明
 * - tools: 允许的工具列表（'*'表示全部，但子代理不会获得Task工具以防止无限递归）
 * - prompt: 专门的系统提示
 */
const AGENT_TYPES: Record<AgentType, AgentConfig> = {
  // 探索: 用于搜索和分析的只读代理
  // 不能修改文件 - 适合广泛探索
  explore: {
    description: '探索代码、查找文件、搜索的只读代理',
    tools: ['bash', 'read_file'],
    prompt: '你是一个探索代理。搜索和分析，但绝不修改文件。返回简洁的摘要。'
  },
  
  // 代码: 用于实现的完整功能代理
  // 拥有所有工具 - 用于实际的编码工作
  code: {
    description: '实现功能和修复错误的完整代理',
    tools: '*',
    prompt: '你是一个编码代理。高效地实现请求的更改。'
  },
  
  // 计划: 用于设计工作的分析代理
  // 只读，专注于生成计划和策略
  plan: {
    description: '设计实现策略的规划代理',
    tools: ['bash', 'read_file'],
    prompt: '你是一个规划代理。分析代码库并输出编号的实现计划。不要进行更改。'
  }
};

/**
 * 为系统提示生成代理类型描述
 */
function getAgentDescriptions(): string {
  return Object.entries(AGENT_TYPES)
    .map(([name, cfg]) => `- ${name}: ${cfg.description}`)
    .join('\n');
}

// =============================================================================
// TodoManager (来自 v2，未更改)
// =============================================================================

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm: string;
}

class TodoManager {
  private items: TodoItem[] = [];

  update(items: TodoItem[]): string {
    const validated: TodoItem[] = [];
    let inProgress = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const content = String(item.content || '').trim();
      const status = (item.status || 'pending').toLowerCase() as TodoStatus;
      const active = String(item.activeForm || '').trim();

      if (!content || !active) {
        throw new Error(`Item ${i}: content and activeForm required`);
      }
      if (!['pending', 'in_progress', 'completed'].includes(status)) {
        throw new Error(`Item ${i}: invalid status`);
      }
      if (status === 'in_progress') inProgress++;

      validated.push({ content, status, activeForm: active });
    }

    if (inProgress > 1) {
      throw new Error('Only one task can be in_progress');
    }

    this.items = validated.slice(0, 20);
    return this.render();
  }

  render(): string {
    if (this.items.length === 0) return 'No todos.';
    
    const lines = this.items.map(t => {
      const mark = t.status === 'completed' ? '[x]' 
        : t.status === 'in_progress' ? '[>]' 
        : '[ ]';
      return `${mark} ${t.content}`;
    });
    
    const done = this.items.filter(t => t.status === 'completed').length;
    return lines.join('\n') + `\n(${done}/${this.items.length} done)`;
  }
}

const TODO = new TodoManager();

// =============================================================================
// 系统提示
// =============================================================================

const SYSTEM = `你是一个编码代理，位于 ${WORKDIR}。

循环: 规划 -> 使用工具行动 -> 报告。

你可以为复杂的子任务生成子代理:
${getAgentDescriptions()}

规则:
- 对需要专注探索或实现的子任务使用 Task 工具
- 使用 TodoWrite 跟踪多步骤工作
- 优先使用工具而不是散文。行动，而不仅仅是解释。
- 完成后，总结发生了什么变化。`;

// =============================================================================
// 基础工具定义
// =============================================================================

const bashTool: Tool = {
  name: 'bash',
  description: '运行 shell 命令。',
  input_schema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command']
  }
};

const read_fileTool: Tool = {
  name: 'read_file',
  description: '读取文件内容。',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' }, limit: { type: 'integer' } },
    required: ['path']
  }
};

const write_fileTool: Tool = {
  name: 'write_file',
  description: '写入文件。',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content']
  }
};

const edit_fileTool: Tool = {
  name: 'edit_file',
  description: '替换文件中的文本。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_text: { type: 'string' },
      new_text: { type: 'string' }
    },
    required: ['path', 'old_text', 'new_text']
  }
};

const todoWriteTool: Tool = {
  name: 'TodoWrite',
  description: '更新任务列表。',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeForm: { type: 'string' }
          },
          required: ['content', 'status', 'activeForm']
        }
      }
    },
    required: ['items']
  }
};

const BASE_TOOLS: Tool[] = [
  bashTool,
  read_fileTool,
  write_fileTool,
  edit_fileTool,
  todoWriteTool
];

// =============================================================================
// 任务工具 - v3 版本的核心新增功能
// =============================================================================

/**
 * Task 工具 - v3 的核心
 * 
 * 允许模型生成具有隔离上下文的子代理。
 */
const taskTool: Tool = {
  name: 'Task',
  description: `为专注的子任务生成一个子代理。

子代理在隔离上下文中运行 - 它们看不到父代理的历史记录。
使用这个工具来保持主对话的清洁。

代理类型:
${getAgentDescriptions()}

使用示例:
- Task(explore): "找到所有使用认证模块的文件"
- Task(plan): "设计数据库迁移策略"
- Task(code): "实现用户注册表单"`,
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: '简短的任务名称 (3-5 个词) 用于进度显示'
      },
      prompt: {
        type: 'string',
        description: '给子代理的详细指令'
      },
      agent_type: {
        type: 'string',
        enum: Object.keys(AGENT_TYPES),
        description: '要生成的代理类型'
      }
    },
    required: ['description', 'prompt', 'agent_type']
  }
};

// 主代理获得包括任务在内的所有工具
const ALL_TOOLS: Tool[] = [...BASE_TOOLS, taskTool];

/**
 * 根据代理类型过滤工具。
 * 
 * 每个代理类型都有一个允许工具的白名单。
 * '*' 表示所有工具 (但子代理不会获得 Task 工具以防止无限递归)。
 */
function getToolsForAgent(agentType: AgentType): Tool[] {
  const allowed = AGENT_TYPES[agentType].tools;
  
  if (allowed === '*') {
    return BASE_TOOLS;  // 所有基础工具，但不包括 Task 工具 (演示中无递归)
  }
  
  return BASE_TOOLS.filter(t => allowed.includes(t.name));
}

// =============================================================================
// 工具实现
// =============================================================================

function safePath(path: string): string {
  const resolved = `${WORKDIR}/${path}`.replace(/\/+/g, '/');
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`路径超出工作区: ${path}`);
  }
  return resolved;
}

async function runBash(command: string): Promise<string> {
  if (['rm -rf /', 'sudo', 'shutdown'].some(d => command.includes(d))) {
    return '错误: 危险命令';
  }
  try {
    const r = Bun.spawn(['bash', '-c', command], {
      cwd: WORKDIR,
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const output = await new Response(r.stdout).text();
    const error = await new Response(r.stderr).text();
    return ((output + error).trim() || '(无输出)').slice(0, 50000);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runRead(path: string, limit?: number): Promise<string> {
  try {
    const safe = safePath(path);
    const lines = (await Bun.file(safe).text()).split('\n');
    if (limit) {
      const truncated = lines.slice(0, limit);
      truncated.push(`... (还有 ${lines.length - limit} 行)`);
      return truncated.join('\n').slice(0, 50000);
    }
    return lines.join('\n').slice(0, 50000);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runWrite(path: string, content: string): Promise<string> {
  try {
    const safe = safePath(path);
    await Bun.write(safe, content);
    return `向 ${path} 写入了 ${content.length} 字节`;
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runEdit(path: string, oldText: string, newText: string): Promise<string> {
  try {
    const safe = safePath(path);
    const text = await Bun.file(safe).text();
    if (!text.includes(oldText)) {
      return `错误: 文本在 ${path} 中未找到`;
    }
    await Bun.write(safe, text.replace(oldText, newText, 1));
    return `已编辑 ${path}`;
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function runTodo(items: TodoItem[]): string {
  try {
    return TODO.update(items);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// =============================================================================
// 子代理执行 - v3 版本的核心
// =============================================================================

/**
 * 在隔离上下文中执行子代理任务。
 * 
 * 这是子代理机制的核心:
 * 
 * 1. 创建隔离的消息历史 (关键: 无父上下文!)
 * 2. 使用代理特定的系统提示
 * 3. 根据代理类型过滤可用工具
 * 4. 运行与主代理相同的查询循环
 * 5. 仅返回最终文本 (而非中间细节)
 * 
 * 父代理只看到摘要，保持其上下文清洁。
 * 
 * 进度显示:
 * --------
 * 运行时，我们显示:
 *   [explore] 查找认证文件 ... 5 个工具, 3.2秒
 * 
 * 这提供了可见性，而不会污染主对话。
 */
async function runTask(
  description: string,
  prompt: string,
  agentType: AgentType
): Promise<string> {
  const startTime = Date.now();
  let toolCount = 0;

  process.stdout.write(`  [${agentType}] ${description} ...`);

  const config = AGENT_TYPES[agentType];

  // 代理特定的系统提示
  const subSystem = `你是一个在 ${WORKDIR} 的 ${agentType} 子代理。

${config.prompt}

完成任务并返回清晰、简洁的摘要。`;

  // 此代理类型的过滤工具
  const subTools = getToolsForAgent(agentType);

  // 隔离的消息历史 - 这是关键!
  // 子代理从头开始，看不到父代理的对话
  const subMessages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt }
  ];

  // 运行相同的代理循环 (静默 - 不打印到主聊天)
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      system: subSystem,
      messages: subMessages,
      tools: subTools,
      max_tokens: 8000
    });

    if (response.stop_reason !== 'tool_use') {
      break;
    }

    const toolCalls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tc of toolCalls) {
      toolCount++;
      const output = await executeTool(tc.name, tc.input);
      results.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: output
      });

      // 更新进度显示
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r  [${agentType}] ${description} ... ${toolCount} 个工具, ${elapsed}s`);
    }

    subMessages.push({ role: 'assistant', content: response.content });
    subMessages.push({ role: 'user', content: results });
  }

  // 最终进度更新
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stdout.write(`\r  [${agentType}] ${description} - 完成 (${toolCount} 个工具, ${elapsed}s)\n`);

  // 提取并仅返回最终文本
  // 这是父代理看到的 - 一个干净的摘要
  const textBlocks = subMessages[subMessages.length - 1].content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );

  if (textBlocks.length > 0) {
    // 获取最后一条助手消息的文本
    const lastAssistant = subMessages.filter(m => m.role === 'assistant').pop();
    if (lastAssistant) {
      const finalText = lastAssistant.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      );
      if (finalText.length > 0) {
        return finalText.map(b => b.text).join('\n');
      }
    }
  }

  return '(子代理未返回文本)';
}

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
    case 'TodoWrite':
      return runTodo(args.items as TodoItem[]);
    case 'Task':
      return runTask(
        args.description as string,
        args.prompt as string,
        args.agent_type as AgentType
      );
    default:
      return `未知的工具: ${name}`;
  }
}

// =============================================================================
// 主代理循环
// =============================================================================

/**
 * 支持子代理的主代理循环。
 * 
 * 与 v1/v2 相同的模式，但现在包括 Task 工具。
 * 当模型调用 Task 时，它会生成一个带有隔离上下文的子代理。
 */
async function agentLoop(messages: Anthropic.MessageParam[]): Promise<void> {
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM,
      messages,
      tools: ALL_TOOLS,
      max_tokens: 8000
    });

    const toolCalls: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        process.stdout.write(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push(block);
      }
    }

    if (response.stop_reason !== 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      return;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tc of toolCalls) {
      // Task 工具有特殊显示处理
      if (tc.name === 'Task') {
        console.log(`\n> 任务: ${tc.input.description}`);
      } else {
        console.log(`\n> ${tc.name}`);
      }

      const output = await executeTool(tc.name, tc.input);

      // 不打印完整 Task 输出 (它管理自己的显示)
      if (tc.name !== 'Task') {
        const preview = output.length > 200 
          ? output.slice(0, 200) + '...' 
          : output;
        console.log(`  ${preview}`);
      }

      results.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: output
      });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: results });
  }
}

// =============================================================================
// 主 REPL
// =============================================================================

async function main() {
  console.log(`\n🤖 Mini Claude Code v3 (带子代理) - ${WORKDIR}`);
  console.log(`代理类型: ${Object.keys(AGENT_TYPES).join(', ')}`);
  console.log('输入任务请求，或输入 "exit" 退出\n');

  const history: Anthropic.MessageParam[] = [];

  while (true) {
    try {
      const userInput = await prompt('你：')?.trim();

      if (!userInput || ['exit', 'quit', 'q'].includes(userInput.toLowerCase())) {
        break;
      }

      history.push({ role: 'user', content: userInput });

      try {
        await agentLoop(history);
      } catch (error) {
        console.error(`错误: ${error instanceof Error ? error.message : error}`);
      }

      console.log();

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
