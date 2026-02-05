#!/usr/bin/env bun
/**
 * v2_todo_agent.ts - Mini Claude Code: 结构化规划 (~300行)
 *
 * 核心理念: "让计划可见"
 * ======================================
 * v1 在简单任务上表现很好。但让它"重构认证模块、添加测试、
 * 更新文档"时，看看会发生什么。没有明确的计划，模型会：
 *   - 随机在任务间跳转
 *   - 忘记已完成的步骤
 *   - 中途失去焦点
 *
 * 问题 - "上下文消退":
 * ----------------------------
 * 在 v1 中，计划只存在于模型的"脑海"中：
 *
 *     v1: "我会先做 A，然后 B，然后 C"  (不可见)
 *         经过 10 次工具调用后: "等等，我在做什么来着？"
 *
 * 解决方案 - TodoWrite 工具:
 * ---------------------------------
 * v2 增加了一个新工具，从根本上改变了代理的工作方式：
 *
 *     v2:
 *       [ ] 重构认证模块
 *       [>] 添加单元测试         <- 当前正在做这个
 *       [ ] 更新文档
 *
 * 现在你（用户）和模型（AI）都能看到计划。模型可以：
 *   - 在工作时更新状态
 *   - 看到已完成和待办的事项
 *   - 一次专注于一个任务
 *
 * 关键约束（并非随意设定 - 这些是保护机制）:
 * ------------------------------------------------------
 *     | 规则              | 原因                              |
 *     |-------------------|----------------------------------|
 *     | 最多 20 项        | 防止无限长的任务列表              |
 *     | 仅一项进行中      | 强制一次只专注于一件事            |
 *     | 必填字段          | 确保结构化输出                    |
 *
 * 深刻洞察:
 * -----------
 * > "约束既限制又赋能。"
 *
 * 待办事项的约束（最多项数、仅一项进行中）赋能了（可见的计划、可追踪的进度）。
 *
 * 这种模式在代理设计中随处可见：
 *   - max_tokens 限制 -> 实现可管理的响应
 *   - 工具模式限制 -> 实现结构化调用
 *   - 待办事项限制 -> 实现复杂任务完成
 *
 * 好的约束不是限制。它们是脚手架。
 *
 * 用法：
 *     bun run src/v2_todo_agent.ts
 */

import Anthropic, { Tool } from "@anthropic-ai/sdk";

// =============================================================================
// 配置
// =============================================================================

const WORKDIR = process.cwd();
const MODEL = process.env.MODEL_ID || "claude-sonnet-4-5";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

// =============================================================================
// TodoManager - v2 的核心新增功能
// =============================================================================

/**
 * 待办事项状态
 */
type TodoStatus = "pending" | "in_progress" | "completed";

/**
 * 单个待办事项
 */
interface TodoItem {
  content: string; // 任务描述
  status: TodoStatus; // 当前状态
  activeForm: string; // 正在进行的描述（现在时）
}

/**
 * 管理带强制约束的结构化任务列表。
 *
 * 关键设计决策:
 * --------------------
 * 1. 最多 20 项: 防止模型创建无尽的列表
 * 2. 仅一项进行中: 强制专注 - 一次只能做一件事
 * 3. 必填字段: 每项需要 content、status 和 activeForm
 *
 * activeForm 字段值得解释：
 * - 它是正在发生的事情的现在时形式
 * - 在状态为 "in_progress" 时显示
 * - 示例: content="添加测试", activeForm="正在添加单元测试..."
 *
 * 这提供了对代理正在做什么的实时可见性。
 */
class TodoManager {
  private items: TodoItem[] = [];

  /**
   * 验证并更新待办事项列表。
   *
   * 模型每次发送一个完整的新列表。我们验证它，
   * 存储它，并返回一个渲染视图供模型查看。
   *
   * 验证规则:
   * - 每项必须有: content, status, activeForm
   * - 状态必须是: pending | in_progress | completed
   * - 同一时间只能有一项是 in_progress
   * - 最多允许 20 项
   *
   * @param items - 新的待办事项列表（完整替换）
   * @returns 渲染后的文本视图
   */
  update(items: TodoItem[]): string {
    const validated: TodoItem[] = [];
    let inProgressCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // 提取并验证字段
      const content = String(item.content || "").trim();
      const status = (item.status || "pending").toLowerCase() as TodoStatus;
      const activeForm = String(item.activeForm || "").trim();

      // 验证检查
      if (!content) {
        throw new Error(`第 ${i} 项: 需要内容 (content)`);
      }
      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`第 ${i} 项: 无效状态 '${status}'`);
      }
      if (!activeForm) {
        throw new Error(`第 ${i} 项: 需要 activeForm`);
      }

      if (status === "in_progress") {
        inProgressCount++;
      }

      validated.push({ content, status, activeForm });
    }

    // 强制执行约束
    if (validated.length > 20) {
      throw new Error("最多允许 20 项待办事项");
    }
    if (inProgressCount > 1) {
      throw new Error("同一时间只能有一项任务进行中 (in_progress)");
    }

    this.items = validated;
    return this.render();
  }

  /**
   * 将待办事项列表渲染为人类可读的文本。
   *
   * 格式:
   *   [x] 已完成的任务
   *   [>] 进行中的任务 <- 正在做某事...
   *   [ ] 待处理的任务
   *
   *   (2/3 已完成)
   *
   * 这个渲染后的文本是模型作为工具结果看到的内容。
   * 然后它可以根据当前状态更新列表。
   */
  render(): string {
    if (this.items.length === 0) {
      return "没有待办事项。";
    }

    const lines: string[] = [];

    for (const item of this.items) {
      if (item.status === "completed") {
        lines.push(`[x] ${item.content}`);
      } else if (item.status === "in_progress") {
        lines.push(`[>] ${item.content} <- ${item.activeForm}`);
      } else {
        lines.push(`[ ] ${item.content}`);
      }
    }

    const completed = this.items.filter((t) => t.status === "completed").length;
    lines.push(`\n(${completed}/${this.items.length} 已完成)`);

    return lines.join("\n");
  }

  /**
   * 获取当前待办事项数量
   */
  get count(): number {
    return this.items.length;
  }
}

// 全局待办事项管理器实例
const TODO = new TodoManager();

// =============================================================================
// 系统提示 - v2 更新版
// =============================================================================

const SYSTEM = `你是一个位于 ${WORKDIR} 的编码代理。

循环: 计划 -> 使用工具执行 -> 更新待办事项 -> 报告。

规则:
- 使用 TodoWrite 跟踪多步骤任务
- 开始任务前标记为 in_progress，完成后标记为 completed
- 优先使用工具而非文字描述。行动，不要只是解释。
- 完成后，总结所做的更改。`;

// =============================================================================
// 系统提醒 - 鼓励使用待办事项的软提示
// =============================================================================

// 对话开始时显示
const INITIAL_REMINDER =
  "<reminder>对于多步骤任务，请使用 TodoWrite。</reminder>";

// 如果模型有一段时间没有更新待办事项时显示
const NAG_REMINDER =
  "<reminder>已超过 10 轮没有更新待办事项。请更新待办事项。</reminder>";

// 跟踪自上次更新待办事项以来的轮数
let roundsWithoutTodo = 0;

// =============================================================================
// 工具定义 (v1 工具 + TodoWrite)
// =============================================================================

/**
 * v2 新增: TodoWrite
 * 这是实现结构化规划的关键新增功能
 */
const todoWriteTool: Tool = {
  name: "TodoWrite",
  description: "更新任务列表。用于计划和跟踪进度。",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "完整的任务列表（替换现有列表）",
        items: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "任务描述",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "任务状态",
            },
            activeForm: {
              type: "string",
              description: '现在时动作，例如 "正在读取文件"',
            },
          },
          required: ["content", "status", "activeForm"],
        },
      },
    },
    required: ["items"],
  },
};

const TOOLS: Tool[] = [
  bashTool,
  read_fileTool,
  write_fileTool,
  edit_fileTool,
  todoWriteTool, // v2 新增
];

// =============================================================================
// 工具实现 (v1 + TodoWrite)
// =============================================================================

function safePath(path: string): string {
  const resolved = `${WORKDIR}/${path}`.replace(/\/+/g, "/");
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`路径超出工作区: ${path}`);
  }
  return resolved;
}

async function runBash(command: string): Promise<string> {
  const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot"];
  if (dangerous.some((d) => command.includes(d))) {
    return "错误: 危险命令已被阻止";
  }
  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd: WORKDIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    return (output + error).trim().slice(0, 50000) || "(无输出)";
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runRead(path: string, limit?: number): Promise<string> {
  try {
    const safe = safePath(path);
    const file = Bun.file(safe);
    const content = await file.text();
    const lines = content.split("\n");

    if (limit && limit < lines.length) {
      const truncated = lines.slice(0, limit);
      truncated.push(`... (还有 ${lines.length - limit} 行)`);
      return truncated.join("\n").slice(0, 50000);
    }
    return content.slice(0, 50000);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runWrite(path: string, content: string): Promise<string> {
  try {
    const safe = safePath(path);
    await Bun.write(safe, content);
    return `已写入 ${content.length} 字节到 ${path}`;
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runEdit(
  path: string,
  oldText: string,
  newText: string,
): Promise<string> {
  try {
    const safe = safePath(path);
    const file = Bun.file(safe);
    const content = await file.text();

    if (!content.includes(oldText)) {
      return `错误: 在 ${path} 中未找到文本`;
    }

    await Bun.write(safe, content.replace(oldText, newText, 1));
    return `已编辑 ${path}`;
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 更新待办事项列表。
 *
 * 模型发送一个完整的新列表（不是差异）。
 * 我们验证它并返回渲染后的视图。
 */
function runTodo(items: TodoItem[]): string {
  try {
    return TODO.update(items);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function executeTool(
  name: string,
  args: Record<string, any>,
): Promise<string> {
  switch (name) {
    case "bash":
      return runBash(args.command as string);
    case "read_file":
      return runRead(args.path as string, args.limit as number | undefined);
    case "write_file":
      return runWrite(args.path as string, args.content as string);
    case "edit_file":
      return runEdit(
        args.path as string,
        args.old_text as string,
        args.new_text as string,
      );
    case "TodoWrite":
      return runTodo(args.items as TodoItem[]);
    default:
      return `未知工具: ${name}`;
  }
}

// =============================================================================
// 代理循环 (带待办事项跟踪)
// =============================================================================

/**
 * 带待办事项使用跟踪的代理循环。
 *
 * 与 v1 相同的核心循环，但现在我们跟踪模型
 * 是否在使用待办事项。如果长时间没有更新，
 * 我们会在下一条用户消息（工具结果）中注入提醒。
 */
async function agentLoop(messages: Anthropic.MessageParam[]): Promise<void> {
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM,
      messages,
      tools: TOOLS,
      max_tokens: 8000,
    });

    const toolCalls: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        process.stdout.write(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push(block);
      }
    }

    if (response.stop_reason !== "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      return;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let usedTodo = false;

    for (const tc of toolCalls) {
      console.log(`\n> ${tc.name}`);

      const output = await executeTool(tc.name, tc.input);
      const preview =
        output.length > 300 ? output.slice(0, 300) + "..." : output;
      console.log(`  ${preview}`);

      results.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: output,
      });

      // 跟踪待办事项使用情况
      if (tc.name === "TodoWrite") {
        usedTodo = true;
      }
    }

    // 更新计数器: 如果使用了待办事项则重置，否则递增
    if (usedTodo) {
      roundsWithoutTodo = 0;
    } else {
      roundsWithoutTodo++;
    }

    messages.push({ role: "assistant", content: response.content });

    // 如果模型没有使用待办事项，将 NAG_REMINDER 注入用户消息
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

// =============================================================================
// 主 REPL
// =============================================================================

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
