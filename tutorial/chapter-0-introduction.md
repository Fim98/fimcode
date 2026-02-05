# 第0章: 前言 - 为什么要学习构建AI编码代理

## 什么是AI编码代理？

AI编码代理是一个能够理解自然语言指令、使用工具操作代码库、并自主完成编程任务的程序。

**传统聊天机器人** vs **AI编码代理**：

```
传统聊天机器人:
用户: "如何读取文件？"
AI: "你可以使用 fs.readFile() 或 Bun.file()..."
[用户需要自己写代码]

AI编码代理:
用户: "重构认证模块使用JWT"
AI: [读取代码] [分析] [修改文件] [运行测试]
✅ "已完成。修改了3个文件，测试通过。"
```

## 为什么要自己构建？

### 1. 理解底层原理

Claude Code、Cursor Agent、GitHub Copilot Workspace 等工具很强大，但它们是黑盒。通过自己构建，你将理解：

- **Agent Loop**: 代理如何自主决策并循环执行
- **工具设计**: 为什么需要结构化工具而非原始bash
- **上下文管理**: 如何处理有限的上下文窗口
- **任务分解**: 如何用子代理处理复杂任务
- **知识外化**: 如何通过"技能"注入领域知识

### 2. 按需定制

当你理解原理后，可以：

- 添加团队特定的工具（如内部API调用）
- 集成自定义工作流（如代码审查流程）
- 优化成本（通过缓存和智能工具选择）
- 添加自定义技能（如特定框架的最佳实践）

### 3. 成本控制

商业AI工具通常按使用量收费。自己构建：

```
商业方案: $20/月 + API调用费用
自建方案: 仅API调用费用（零边际成本）
```

## 本教程的独特之处

### 渐进式演进

我们不会直接扔给你一个复杂的系统。而是从**最简版本**开始，每章添加一个关键特性：

| 版本 | 新增特性 | 代码行数 |
|------|----------|----------|
| v0 | Bash工具 + 代理循环 | ~50行 |
| v1 | 结构化工具（4个基础工具） | ~200行 |
| v2 | TodoWrite（任务规划） | ~300行 |
| v3 | 子代理（上下文隔离） | ~450行 |
| v4 | 技能系统（知识外化） | ~550行 |

### 完整的代码

每个版本都是**可运行的完整程序**，不是代码片段。你可以：

```bash
bun run src/v0_bash_agent.ts "探索项目结构"
```

### 深度注释

代码中的注释不仅说"做什么"，还解释"为什么"：

```typescript
// 为什么用tool_result注入而非system？
// 因为system更改会使提示缓存失效，成本增加20-50倍
```

## 技术栈

### 为什么选择Bun？

```typescript
// Node.js
fs.readFile(path, 'utf8', (err, data) => { ... });

// Bun (更简洁，原生支持async/await)
const content = await Bun.file(path).text();
```

- **更快的启动时间**: 对子代理特别重要
- **原生TypeScript**: 无需编译步骤
- **内置工具**: file API、spawn、glob等开箱即用

### 为什么选择 @anthropic-ai/sdk？

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-sonnet-4-5',
  tools: TOOLS,
  messages: messages
});
```

- 官方维护，API稳定
- 原生支持工具调用
- 类型安全（TypeScript）

## 学习路径

```
第0章 (本章)     → 理解AI编码代理的概念
     ↓
第1章 v0         → 用50行构建最简代理
     ↓
第2章 v1         → 添加结构化工具
     ↓
第3章 v2         → 添加任务规划能力
     ↓
第4章 v3         → 添加子代理机制
     ↓
第5章 v4         → 添加技能系统
     ↓
恭喜！你现在理解了Claude Code的核心架构
```

## 前置知识

- **基础TypeScript**: 类、接口、async/await
- **命令行基础**: ls, cat, grep等基础命令
- **REST API概念**: 理解请求/响应模型

不需要：
- ❌ 机器学习经验
- ❌ 高级系统编程
- ❌ 之前的Agent开发经验

## 让我们开始吧！

```bash
# 克隆或创建项目
mkdir my-agent && cd my-agent
bun init -y
bun add @anthropic-ai/sdk

# 设置环境变量
echo "ANTHROPIC_API_KEY=your_key_here" > .env
echo "MODEL_ID=claude-sonnet-4-5" >> .env
```

下一章，我们将用**50行代码**构建第一个可运行的AI代理。
