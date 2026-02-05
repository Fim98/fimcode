#!/usr/bin/env bun
/**
 * v0_bash_agent.ts - Mini Claude Code: Bash Is All You Need (~50行核心)
 * 
 * 核心理念: "Bash Is All You Need"
 * ====================================
 * 这是一个代码代理的终极简化版本。在构建了v1-v4之后，
 * 我们问：代理的本质是什么？
 * 
 * 答案是：一个工具（bash） + 一个循环 = 完整的代理能力。
 * 
 * 为什么Bash足够：
 * ----------------
 * Unix哲学认为一切都是文件，一切都可以通过管道传输。
 * Bash是通往这个世界的门户：
 * 
 *   | 你需要      | Bash命令                           |
 *   |-------------|------------------------------------|
 *   | 读取文件    | cat, head, tail, grep              |
 *   | 写入文件    | echo '...' > file, cat << 'EOF'    |
 *   | 搜索        | find, grep, rg, ls                 |
 *   | 执行        | python, npm, make, any command     |
 *   | **子代理**  | bun run v0_bash_agent.ts "task"    |
 * 
 * 最后一行是关键洞察：通过bash调用自身来实现子代理！
 * 不需要Task工具，不需要Agent Registry - 只需要通过进程生成进行递归。
 * 
 * 子代理的工作方式：
 * ------------------
 *   主代理
 *     |-- bash: bun run v0_bash_agent.ts "analyze architecture"
 *          |-- 子代理（隔离进程，新的历史）
 *               |-- bash: find . -name "*.ts"
 *               |-- bash: cat src/main.ts
 *               |-- 通过stdout返回摘要
 * 
 * 进程隔离 = 上下文隔离：
 * - 子进程有自己的history=[]
 * - 父进程捕获stdout作为工具结果
 * - 递归调用实现无限嵌套
 * 
 * 用法：
 *   # 交互模式
 *   bun run src/v0_bash_agent.ts
 * 
 *   # 子代理模式（由父代理或直接调用）
 *   bun run src/v0_bash_agent.ts "explore src/ and summarize"
 */

import Anthropic from '@anthropic-ai/sdk';

// =============================================================================
// 配置
// =============================================================================

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL
});

const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-5';
const WORKDIR = process.cwd();

// =============================================================================
// 工具定义 - 唯一的工具可以做一切
// =============================================================================

/**
 * 这个唯一的工具可以做一切。
 * 注意描述如何教会模型常见模式以及如何生成子代理。
 */
const BASH_TOOL: Anthropic.Tool = {
  name: 'bash',
  description: `执行shell命令。常见模式：
- 读取：cat/head/tail, grep/find/rg/ls, wc -l
- 写入：echo 'content' > file, sed -i 's/old/new/g' file
- 子代理：bun run src/v0_bash_agent.ts 'task description'（生成隔离代理，返回摘要）`,
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string' }
    },
    required: ['command']
  }
};

// =============================================================================
// 系统提示 - 教会模型如何有效地使用bash
// =============================================================================

/**
 * 系统提示教会模型如何有效地使用bash。
 * 注意子代理指导 - 这是如何实现分层任务分解的。
 */
const SYSTEM_PROMPT = `你是一个CLI代理在 ${WORKDIR}。使用bash命令解决问题。

规则：
- 优先使用工具而不是文字。先行动，后解释。
- 读取文件：cat, grep, find, rg, ls, head, tail
- 写入文件：echo '...' > file, sed -i, 或 cat << 'EOF' > file
- 子代理：对于复杂的子任务，生成子代理以保持上下文清晰：
  bun run src/v0_bash_agent.ts "explore src/ and summarize the architecture"

何时使用子代理：
- 任务需要读取许多文件（隔离探索）
- 任务是独立且自包含的
- 你希望避免用中间细节污染当前对话

子代理在隔离中运行并仅返回其最终摘要。`;

// =============================================================================
// 代理循环 - 一个函数中的完整代理
// =============================================================================

/**
 * 一个函数中的完整代理循环。
 * 
 * 这是所有编码代理共享的核心模式：
 *     while not done:
 *         response = model(messages, tools)
 *         if no tool calls: return
 *         execute tools, append results
 * 
 * @param prompt - 用户的请求
 * @param history - 对话历史（可变，在交互模式下跨调用共享）
 * @returns 模型的最终文本响应
 */
async function chat(
  prompt: string,
  history: Anthropic.MessageParam[] = []
): Promise<string> {
  // 初始化历史（如果为空）
  if (history.length === 0) {
    history.push({ role: 'user', content: prompt });
  }

  // 代理循环：持续运行直到模型不再调用工具
  while (true) {
    // 步骤1: 调用带有工具的模型
    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages: history,
      tools: [BASH_TOOL],
      max_tokens: 8000
    });

    // 步骤2: 添加助手响应到历史
    history.push({ role: 'assistant', content: response.content });

    // 步骤3: 如果模型没有调用工具，我们完成了
    if (response.stop_reason !== 'tool_use') {
      // 提取并返回所有文本块
      const textBlocks = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      return textBlocks;
    }

    // 步骤4: 执行每个工具调用并收集结果
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'bash') {
        const cmd = block.input.command as string;
        console.log(`\x1b[33m$ ${cmd}\x1b[0m`); // 黄色显示命令

        // 执行bash命令
        const proc = Bun.spawn(['bash', '-c', cmd], {
          cwd: WORKDIR,
          stdout: 'pipe',
          stderr: 'pipe'
        });

        const output = await new Response(proc.stdout).text();
        const error = await new Response(proc.stderr).text();
        const result = (output + error).trim() || '(empty)';

        console.log(result);

        // 截断非常长的输出以防止上下文溢出
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.slice(0, 50000)
        });
      }
    }

    // 步骤5: 附加结果并继续循环
    history.push({ role: 'user', content: results });
  }
}

// =============================================================================
// 主程序
// =============================================================================

/**
 * 主入口点：
 * - 有参数：子代理模式（执行任务并打印结果）
 * - 无参数：交互REPL模式
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // 子代理模式：执行任务并打印结果
    // 这是父代理通过bash生成子代理的方式
    const task = args.join(' ');
    const result = await chat(task);
    console.log(result);
  } else {
    // 交互REPL模式
    console.log(`\n🤖 Mini Claude Code v0 - ${WORKDIR}`);
    console.log('输入任务请求，或输入 "exit" 退出\n');

    const history: Anthropic.MessageParam[] = [];

    while (true) {
      try {
        const query = await prompt('\x1b[36m>> \x1b[0m'); // 青色提示
        if (!query || query === 'q' || query === 'exit' || query === 'quit') {
          break;
        }

        const response = await chat(query, history);
        console.log(`\x1b[32m${response}\x1b[0m`); // 绿色显示响应
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
}

main().catch(console.error);
