# 第1章: Bash Is All You Need - 用50行构建最简代理

## 核心理念

**一个工具 + 一个循环 = 完整的代理能力**

在这一章，我们将用最简的方式构建一个可运行的AI编码代理。通过这个版本，你将理解所有AI代理的核心模式。

## 为什么Bash足够？

Unix哲学认为"一切都是文件"。Bash是通往这个世界的门户：

| 你需要      | Bash命令                           |
|-------------|------------------------------------|
| 读取文件    | cat, head, tail, grep              |
| 写入文件    | echo '...' > file, cat << 'EOF'    |
| 搜索        | find, grep, rg, ls                 |
| 执行        | python, npm, make, any command     |
| **子代理**  | bun run v0_bash_agent.ts "task"    |

最后一行是关键：通过bash调用自身实现子代理！不需要复杂的Task工具，只需要进程生成。

## 代码实现

完整的代码只有约150行（包括注释），核心逻辑不到50行。

```typescript
#!/usr/bin/env bun
import Anthropic from '@anthropic-ai/sdk';

// 配置
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});
const MODEL = 'claude-sonnet-4-5';

// 唯一的工具
const BASH_TOOL = {
  name: 'bash',
  description: '执行shell命令',
  input_schema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command']
  }
};

// 代理循环
async function chat(prompt: string, history = []) {
  history.push({ role: 'user', content: prompt });

  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      messages: history,
      tools: [BASH_TOOL],
      max_tokens: 8000
    });

    history.push({ role: 'assistant', content: response.content });

    // 如果没有工具调用，返回文本
    if (response.stop_reason !== 'tool_use') {
      return response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
    }

    // 执行工具并收集结果
    const results = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const cmd = block.input.command;
        const proc = Bun.spawn(['bash', '-c', cmd], {
          stdout: 'pipe', stderr: 'pipe'
        });
        const output = await new Response(proc.stdout).text();
        console.log(`$ ${cmd}`);
        console.log(output);
        
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output
        });
      }
    }

    history.push({ role: 'user', content: results });
  }
}

// 主程序
const task = process.argv[2];
if (task) {
  console.log(await chat(task));
} else {
  // REPL模式
  const history = [];
  while (true) {
    const query = await prompt('>> ');
    if (!query || query === 'exit') break;
    console.log(await chat(query, history));
  }
}
```

## 关键点解析

### 1. 代理循环模式

这是所有AI代理的核心模式：

```
while not done:
    response = model(messages, tools)
    if no tool calls: return
    execute tools, append results, continue
```

模型决定：
- 是否使用工具
- 使用哪个工具
- 何时停止

### 2. 子代理的实现

如何实现子代理？简单：通过bash调用自己！

```typescript
// 系统提示中告诉模型
description: `子代理：bun run v0_bash_agent.ts 'task description'`

// 模型会生成：
bash: bun run v0_bash_agent.ts "explore src/ and summarize"

// 这会启动新的进程，独立的历史，返回摘要
```

**进程隔离 = 上下文隔离**

### 3. 对话历史管理

```typescript
history.push({ role: 'user', content: prompt });     // 用户输入
history.push({ role: 'assistant', content: response });  // AI响应
history.push({ role: 'user', content: toolResults });    // 工具结果
```

注意：工具结果作为"user"角色返回！这是Anthropic API的要求。

## 运行示例

```bash
# 交互模式
$ bun run src/v0_bash_agent.ts

>> 列出当前目录的TypeScript文件
$ find . -name "*.ts" -type f
./src/v0_bash_agent.ts

>> 读取v0_bash_agent.ts的前20行
$ head -n 20 ./src/v0_bash_agent.ts
#!/usr/bin/env bun
...

# 子代理模式（从命令行）
$ bun run src/v0_bash_agent.ts "分析项目结构并总结"
$ find . -type f -name "*.ts" ...
$ cat package.json ...
项目包含1个TypeScript文件，使用Anthropic SDK...
```

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    用户输入                               │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│               chat(prompt, history)                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │        while (stop_reason === 'tool_use')       │   │
│  │                                                   │   │
│  │  ┌───────────────────────────────────────────┐  │   │
│  │  │  调用模型                                  │  │   │
│  │  │  messages.create({ tools, history })      │  │   │
│  │  └───────────────┬───────────────────────────┘  │   │
│  │                  ▼                              │   │
│  │  ┌───────────────────────────────────────────┐  │   │
│  │  │  解析响应                                  │  │   │
│  │  │  - 工具调用? → 执行并继续                  │  │   │
│  │  │  - 仅文本? → 返回结果                      │  │   │
│  │  └───────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## 练习

1. **基本使用**：运行代理，让它列出当前目录的文件

2. **子代理测试**：让代理"分析src/目录并总结"，观察它是否使用子代理

3. **修改系统提示**：添加一条规则，让模型在执行任何命令前先解释意图

## 下一步

v0版本工作良好，但有一些问题：

- **危险**：bash可以执行任何命令，包括删除文件
- **低效**：读取文件不需要生成子进程
- **不精确**：输出解析很脆弱

下一章，我们将添加**结构化工具**来解决这些问题。
