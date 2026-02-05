#!/usr/bin/env bun
import Anthropic from "@anthropic-ai/sdk";
import { executeTool, Tools } from "./tools";

// 配置
const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL,
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
});

const MODEL = "gemini-3-flash-preview";
const WORKDIR = process.cwd();
const SYSTEM_PROMPT = `你是位于${WORKDIR}的编程代理。
循环：简短思考 -> 使用工具 -> 报告结果。

规则：
- 优先使用工具而非文字。先行动，后解释。
- 不要虚构文件路径。如果不确定，使用bash ls/find。
- 做最少的更改。不要过度设计。
- 完成后，总结改变了什么

何时使用子代理:
- 任务需要读取许多文件(隔离探索)
- 任务是独立且自包含的
- 你希望避免用中间细节污染当前对话

子代理在隔离中运行并仅返回其最终摘要。
`;
// 对话开始时显示
const INITIAL_REMINDER =
  "<reminder>对于多步骤任务，请使用 todo_write</reminder>";

// 如果模型有一段时间没有更新待办事项时显示
const NAG_REMINDER =
  "<reminder>已超过 10 轮没有更新待办事项。请更新待办事项。</reminder>";

// 跟踪自上次更新待办事项以来的轮数
let roundsWithoutTodo = 0;

// agent loop
async function agentLoop(messages: Anthropic.MessageParam[]): Promise<void> {
  while (true) {
    // 步骤1:调用模型
    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages,
      tools: Tools,
      max_tokens: 8000,
    });

    // 步骤2:收集任何工具调用并打印文本输出
    const toolCalls: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        // 打印模型的文本输出
        process.stdout.write(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push(block);
      }
    }

    // 步骤3:如果没有工具调用，任务完成
    if (response.stop_reason !== "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      return;
    }

    // 步骤4:执行每个工具并收集结果
    const results: Anthropic.ToolResultBlockParam[] = [];
    let usedTodo = false;

    for (const tc of toolCalls) {
      // 显示正在执行的内容
      console.log(`\n> ${tc.name}:`);

      // 执行并显示结果预览
      const output = await executeTool(tc.name, tc.input);
      const preview =
        output.length > 300 ? output.slice(0, 300) + "..." : output;
      console.log(` ${preview}`);

      results.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: output,
      });

      // 跟踪待办事项使用情况
      if (tc.name === "todo_write") {
        usedTodo = true;
      }
    }

    // 更新计数器：如果使用了待办事项则重置，否则递增
    if (usedTodo) {
      roundsWithoutTodo = 0;
    } else {
      roundsWithoutTodo++;
    }

    // 步骤5:添加到对话并继续
    messages.push({ role: "assistant", content: response.content });

    // 如果模型没有使用待办事项，将NAG_REMINDER 注入用户消息
    // 这发生在代理循环内部，因此模型在执行任务时能看到它
    if (roundsWithoutTodo > 10) {
      results.unshift({
        type: "text",
        text: NAG_REMINDER,
      });
    }
    messages.push({ role: "user", content: results });
  }
}

/**
 * 带提醒注入的 REPL。
 *
 * v2 的关键新增功能: 我们注入"提醒"消息以鼓励
 * 使用待办事项，而不强制要求。这是一个软约束。
 *
 * - INITIAL_REMINDER: 在对话开始时注入
 * - NAG_REMINDER: 当超过 10 轮没有使用待办事项时在 agent_loop 内部注入
 */
async function main() {
  console.log(`\n🤖 Mini Claude Code v2 (带待办事项) - ${WORKDIR}`);
  console.log('输入任务请求，或输入 "exit" 退出\n');

  const history: Anthropic.MessageParam[] = [];
  let firstMessage = true;

  while (true) {
    try {
      const userInput = await prompt("你：")?.trim();

      if (
        !userInput ||
        ["exit", "quit", "q"].includes(userInput.toLowerCase())
      ) {
        break;
      }

      // 构建用户消息内容
      const content: Array<Anthropic.TextBlockParam> = [];

      if (firstMessage) {
        // 对话开始时的温和提醒
        content.push({
          type: "text",
          text: INITIAL_REMINDER,
        });
        firstMessage = false;
      }

      content.push({
        type: "text",
        text: userInput,
      });

      history.push({ role: "user", content });

      try {
        await agentLoop(history);
      } catch (error) {
        console.error(
          `错误: ${error instanceof Error ? error.message : error}`,
        );
      }

      console.log();
    } catch (error) {
      if (error instanceof Error && error.message.includes("EOF")) {
        break;
      }
      throw error;
    }
  }

  console.log("再见！");
}

main().catch(console.error);
