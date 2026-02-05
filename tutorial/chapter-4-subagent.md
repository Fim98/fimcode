# 第4章: 分而治之 - 添加子代理机制

## 核心理念

**进程隔离 = 上下文隔离**

v2可以处理多步骤任务，但面对大型任务时：

```
用户: "探索整个代码库然后重构认证"
v2: [读取file1.py] [读取file2.py] ... [读取file20.py]
    上下文满了！模型开始遗忘早期信息
```

这是**上下文污染**问题。

## 解决方案：子代理

```
主代理 (干净上下文)
  ↓
Task(explore): "探索代码库"
  ↓
子代理 (隔离上下文)
  [读取20个文件] → 返回摘要:"认证在src/auth/"
  ↑
主代理收到摘要，上下文仍然干净
```

## 代理类型

| 类型 | 工具 | 用途 |
|------|------|------|
| `explore` | bash, read_file | 只读探索，不能修改 |
| `plan` | bash, read_file | 分析并生成计划 |
| `code` | 所有工具 | 实际编码工作 |

## 代码实现要点

### 1. 代理类型注册表

```typescript
const AGENT_TYPES: Record<AgentType, AgentConfig> = {
  explore: {
    description: '探索代码、查找文件、搜索的只读代理',
    tools: ['bash', 'read_file'],
    prompt: '你是一个探索代理。搜索和分析，但绝不修改文件。'
  },
  code: {
    description: '实现功能和修复错误的完整代理',
    tools: '*',
    prompt: '你是一个编码代理。高效地实现请求的更改。'
  },
  plan: {
    description: '设计实现策略的规划代理',
    tools: ['bash', 'read_file'],
    prompt: '你是一个规划代理。分析代码库并输出编号的实现计划。'
  }
};
```

### 2. Task 工具

```typescript
const taskTool: Tool = {
  name: 'Task',
  description: '生成子代理以处理专注的子任务',
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      prompt: { type: 'string' },
      agent_type: { 
        type: 'string', 
        enum: ['explore', 'code', 'plan'] 
      }
    },
    required: ['description', 'prompt', 'agent_type']
  }
};
```

### 3. 隔离的代理循环

```typescript
async function runTask(description: string, prompt: string, agentType: AgentType): Promise<string> {
  // 隔离的消息历史 - 关键！
  const subMessages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt }
  ];

  // 过滤的工具
  const subTools = getToolsForAgent(agentType);

  // 运行相同的代理循环
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      system: subSystem,
      messages: subMessages,
      tools: subTools,
      max_tokens: 8000
    });

    if (response.stop_reason !== 'tool_use') break;
    // ... 执行工具 ...
  }

  // 仅返回最终摘要！
  return extractFinalText(response);
}
```

### 4. 工具过滤

```typescript
function getToolsForAgent(agentType: AgentType): Tool[] {
  const allowed = AGENT_TYPES[agentType].tools;
  
  if (allowed === '*') {
    return BASE_TOOLS;  // 所有基础工具，但不包括Task
  }
  
  return BASE_TOOLS.filter(t => allowed.includes(t.name));
}
```

子代理不会获得Task工具，防止无限递归！

## 运行示例

```bash
$ bun run src/v3_subagent.ts

你：重构整个认证系统，使用JWT替换session

我会帮你重构认证系统。让我先探索当前的认证实现。

> Task: {"description":"探索认证代码","prompt":"找到所有认证相关文件并总结架构","agent_type":"explore"}

  [explore] 探索认证代码 ... 8 个工具, 2.3s

子代理发现认证系统位于:
- src/auth/login.ts (登录逻辑)
- src/auth/session.ts (session管理)
- src/middleware/auth.ts (认证中间件)

现在让我设计迁移计划。

> Task: {"description":"设计JWT迁移","prompt":"设计从session到JWT的迁移计划","agent_type":"plan"}

  [plan] 设计JWT迁移 ... 3 个工具, 1.1s

迁移计划:
1. 安装jsonwebtoken和@types/jsonwebtoken
2. 创建src/auth/jwt.ts工具模块
3. 修改login.ts返回JWT而非session
4. 更新middleware/auth.ts验证JWT
5. 移除session.ts

开始实施。

> TodoWrite: {...}

[ ] 安装JWT依赖
[>] 创建JWT工具模块
[ ] 修改登录逻辑
[ ] 更新中间件
[ ] 清理session代码

(0/5 完成)
```

## 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    主代理 (干净上下文)                        │
│  history: [用户: 重构认证]                                    │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                  Task(explore, "探索代码")                    │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              子代理 (隔离上下文 - 新的history)                 │
│  history: [用户: 探索代码]                                    │
│  tools: [bash, read_file] (无写入权限)                        │
│                                                               │
│  [bash: find . -name "*.ts"]                                  │
│  [read_file: src/auth/login.ts]                              │
│  [read_file: src/middleware/auth.ts]                          │
│  ... 8个工具调用 ...                                          │
│                                                               │
│  返回摘要: "认证在src/auth/, 中间件在src/middleware/"         │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              主代理收到摘要 (上下文仍然干净)                   │
│  history: [用户: 重构认证,                                    │
│           助手: Task(...),                                    │
│           用户: <摘要> "认证在src/auth..."]                   │
└──────────────────────────────────────────────────────────────┘
```

## 关键洞察

### 1. 上下文隔离的价值

```
单一代理:
历史 = [20个文件读取 + 实际工作] = 上下文溢出

子代理:
历史 = [探索摘要 + 实际工作] = 干净简洁
```

### 2. 代理类型即权限

```typescript
explore: [bash, read_file]   // 只读 = 安全探索
code:    [所有工具]           // 完全权限 = 实际工作
plan:    [bash, read_file]   // 只读 = 规划不修改
```

### 3. 递归而不无限

```typescript
// 子代理不会获得Task工具
function getToolsForAgent(agentType) {
  return BASE_TOOLS;  // 不包括taskTool
}
```

## 练习

1. **添加parallel代理类型**：支持并行执行多个子任务

2. **添加超时控制**：为子代理添加最大执行时间限制

3. **实现嵌套限制**：限制子代理的嵌套深度

## 对比v2

| 特性 | v2 | v3 |
|------|----|----|
| 上下文管理 | 单一历史，容易污染 | 子代理隔离 |
| 任务类型 | 所有任务相同 | explore/plan/code |
| 大型探索 | 上下文溢出 | 干净摘要 |
| 权限控制 | 所有工具可用 | 按类型过滤 |

## 下一步

v3有子代理处理复杂任务，但还有一个问题：

```
用户: "处理PDF文件"
v3: [不知道如何处理PDF] 
    "我应该用pdftotext还是PyMuPDF？"
```

模型缺乏领域知识。下一章，我们将添加**技能系统**来注入专业知识。
