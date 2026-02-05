# 从0到1构建AI编码代理

一份完整的教程，教你如何使用 **Bun + @anthropic-ai/sdk** 从零开始构建类似 Claude Code 的 AI 编码代理。

## 教程特点

- **渐进式演进**：从50行最简版本开始，每章添加一个核心功能
- **完整可运行**：每个版本都是可运行的完整程序，非代码片段
- **深度注释**：解释"为什么"，不只是"做什么"
- **TypeScript/Bun**：现代化的技术栈

## 学习路径

```
第0章  → 理解AI编码代理的概念
  ↓
第1章  → v0: Bash Is All You Need (~50行)
  ↓     核心Agent Loop + 单一bash工具
第2章  → v1: 结构化工具 (~200行)
  ↓     4个基础工具：bash, read_file, write_file, edit_file
第3章  → v2: 任务规划 (~300行)
  ↓     TodoWrite工具 + TodoManager类
第4章  → v3: 子代理机制 (~450行)
  ↓     Task工具 + 上下文隔离
第5章  → v4: 技能系统 (~550行)
        Skill工具 + 知识外化
```

## 章节目录

| 章节 | 版本 | 主题 | 代码行数 | 核心特性 |
|------|------|------|----------|----------|
| [第0章](chapter-0-introduction.md) | - | 前言 | - | 为什么要学习构建代理 |
| [第1章](chapter-1-bash-agent.md) | v0 | Bash Is All You Need | ~50 | Agent Loop + bash工具 |
| [第2章](chapter-2-basic-agent.md) | v1 | 结构化工具 | ~200 | 4个基础工具 + 路径安全 |
| [第3章](chapter-3-todo-agent.md) | v2 | 任务规划 | ~300 | TodoWrite + TodoManager |
| [第4章](chapter-4-subagent.md) | v3 | 子代理 | ~450 | Task工具 + 上下文隔离 |
| [第5章](chapter-5-skills-agent.md) | v4 | 技能系统 | ~550 | Skill工具 + 知识外化 |

## 快速开始

### 前置要求

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 或使用 Homebrew
brew install oven-sh/bun/bun
```

### 项目设置

```bash
# 进入教程目录
cd tutorial

# 安装依赖
bun install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，添加你的 ANTHROPIC_API_KEY
```

### 运行示例

```bash
# 运行 v0 - 最简版本
bun run src/v0_bash_agent.ts

# 运行 v1 - 带结构化工具
bun run src/v1_basic_agent.ts

# 运行 v2 - 带任务规划
bun run src/v2_todo_agent.ts

# 运行 v3 - 带子代理
bun run src/v3_subagent.ts

# 运行 v4 - 带技能系统
bun run src/v4_skills_agent.ts
```

## 技术栈

- **运行时**: [Bun](https://bun.sh/) - 快速的JavaScript运行时
- **语言**: TypeScript - 类型安全
- **SDK**: [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk) - Anthropic官方SDK

## 核心概念

### Agent Loop

所有AI代理的核心模式：

```typescript
while (true) {
  const response = await client.messages.create({
    model: MODEL,
    tools: TOOLS,
    messages: history
  });

  if (response.stop_reason !== 'tool_use') {
    return response; // 完成
  }

  // 执行工具，添加结果，继续循环
  const results = await executeTools(response);
  history.push(results);
}
```

### 工具 vs 技能

| 概念 | 定义 | 示例 |
|------|------|------|
| **工具** | 代理能做什么 | bash, read_file, write |
| **技能** | 代理知道怎么做 | PDF处理, MCP开发 |

### 代理类型

| 类型 | 工具 | 用途 |
|------|------|------|
| `explore` | bash, read_file | 只读探索 |
| `plan` | bash, read_file | 分析并规划 |
| `code` | 所有工具 | 实际编码 |

## 项目结构

```
tutorial/
├── README.md                    # 本文件
├── chapter-0-introduction.md    # 前言
├── chapter-1-bash-agent.md      # 第1章
├── chapter-2-basic-agent.md     # 第2章
├── chapter-3-todo-agent.md      # 第3章
├── chapter-4-subagent.md        # 第4章
├── chapter-5-skills-agent.md    # 第5章
├── src/
│   ├── v0_bash_agent.ts         # v0版本
│   ├── v1_basic_agent.ts        # v1版本
│   ├── v2_todo_agent.ts         # v2版本
│   ├── v3_subagent.ts           # v3版本
│   └── v4_skills_agent.ts       # v4版本
└── skills/                      # 技能目录
    └── pdf/
        └── SKILL.md             # PDF处理技能示例
```

## 学习收获

完成本教程后，你将理解：

1. **Agent Loop** - 所有AI代理的核心模式
2. **工具设计** - 为什么需要结构化工具
3. **上下文管理** - 如何处理有限的上下文窗口
4. **任务分解** - 用子代理处理复杂任务
5. **知识外化** - 通过技能注入领域知识

这些正是 Claude Code、Cursor Agent、GitHub Copilot Workspace 等工具的核心原理。

## 进阶方向

完成基础教程后，你可以：

1. **扩展技能库** - 为你的工作流创建自定义技能
2. **添加更多工具** - 实现网络请求、数据库操作等
3. **优化性能** - 实现请求批流、并行子代理
4. **构建UI** - 添加TUI或Web界面
5. **部署** - 打包为CLI工具供团队使用

## 资源

- [Anthropic API 文档](https://docs.anthropic.com/)
- [Bun 文档](https://bun.sh/docs)
- [Claude Code 文档](https://code.claude.com/docs)

## 许可

本教程内容可自由学习和分享。

---

开始学习：[第0章 - 前言](chapter-0-introduction.md) →
