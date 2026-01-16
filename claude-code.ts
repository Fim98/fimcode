import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "读取文件的内容",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "向文件写入内容",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "要写入的内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "通过替换唯一字符串对文件进行精确编辑",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_str: {
          type: "string",
          description: "要查找的确切字符串(必须在文件中唯一)",
        },
        new_str: { type: "string", description: "用其替换的字符串" },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
  {
    name: "glob",
    description: "查找匹配模式的文件",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob 模式，例如 '**/*.ts'",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description: "在文件中搜索正则表达式模式",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "要搜索的正则表达式模式" },
        path: { type: "string", description: "要搜索的目录或文件" },
      },
      required: ["pattern", "path"],
    },
  },
  {
    name: "run_bash",
    description: "运行 bash 命令",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要运行的命令" },
      },
      required: ["command"],
    },
  },
];

async function compactConversation(
  messages: Anthropic.MessageParam[]
): Promise<Anthropic.MessageParam[]> {
  const summaryPrompt = `简洁地总结此对话,保留:
    - 原始任务
    - 关键发现和决策
    - 工作的当前状态
    - 还需要做什么`;

  const summary = await client.messages.create({
    model: "glm-4.7",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `${JSON.stringify(messages)}\n\n${summaryPrompt}`,
      },
    ],
  });

  const summaryText =
    summary.content[0]?.type === "text" ? summary.content[0].text : "";

  return [
    {
      role: "user",
      content: `先前工作总结：\n${summaryText}`,
    },
  ];
}

async function executeTool(name: string, input: any): Promise<string> {
  if (name === "read_file") {
    try {
      const file = Bun.file(input.path);
      const content = await file.text();
      return content;
    } catch (e: any) {
      return `错误：${e.message}`;
    }
  } else if (name === "write_file") {
    try {
      await Bun.write(input.path, input.content);
      return `成功写入${input.path}`;
    } catch (e: any) {
      return `错误：${e.message}`;
    }
  } else if (name === "edit_file") {
    try {
      const file = Bun.file(input.path);
      const content = await file.text();

      const count = content.split(input.old_str).length - 1;
      if (count === 0) {
        return `错误：'${input.old_str}' 未在文件中找到`;
      }
      if (count > 1) {
        return `错误：'${input.old_str}' 找到${count}个匹配项，只能替换一个`;
      }

      const newContent = content.replace(input.old_str, input.new_str);
      await Bun.write(input.path, newContent);

      return `成功替换${input.path}`;
    } catch (e: any) {
      return `错误：${e.message}`;
    }
  } else if (name === "glob") {
    try {
      const glob = new Bun.Glob(input.pattern);
      const files = Array.from(glob.scanSync());
      return files.join("\n");
    } catch (e: any) {
      return `错误：${e.message}`;
    }
  } else if (name === "grep") {
    try {
      const proc = Bun.spawn(["grep", "-r", input.pattern, input.path], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      const error = await new Response(proc.stderr).text();
      return output + error;
    } catch (e: any) {
      return `错误：${e.message}`;
    }
  } else if (name === "run_bash") {
    try {
      const proc = Bun.spawn(["bash", "-c", input.command], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      const error = await new Response(proc.stderr).text();
      return output + error;
    } catch (e: any) {
      return `错误：${e.message}`;
    }
  }
  return `未知工具：${name}`;
}

async function runAgent(task: string) {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: task }];

  while (true) {
    const response = await client.messages.create({
      model: "gemini-claude-sonnet-4-5",
      max_tokens: 4096,
      tools: TOOLS,
      messages: messages,
    });

    // 检查是否完成
    if (response.stop_reason === "end_turn") {
      for (const block of response.content) {
        if (block.type === "text") {
          console.log(`✅${block.text}`);
        }
      }
      break;
    }

    // 处理工具使用
    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`🔧 ${block.name}:${JSON.stringify(block.input)}`);
          const result = await executeTool(block.name, block.input);
          console.log(
            ` -> ${result.substring(0, 200)}${result.length > 200 ? "..." : ""}`
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }
}

const task = process.argv[2];
if (!task) {
  console.log("请输入任务");
  process.exit(1);
}

await runAgent(task);
