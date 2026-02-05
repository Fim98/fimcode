# 第2章: 模型即代理 - 添加结构化工具

## 核心理念

**模型是决策者，代码只是工具和循环**

v0版本展示了核心模式，但bash太危险且不精确。本章添加4个结构化工具，覆盖90%的编码场景。

## 为什么要结构化工具？

### v0的问题

```typescript
// v0: 只有bash
模型: "读取package.json"
→ bash: cat package.json  # 生成子进程，慢
→ 解析输出，可能失败

模型: "删除所有文件"  # 危险！
→ bash: rm -rf *      # 灾难！
```

### v1的解决

```typescript
// v1: 结构化工具
模型: "读取package.json"
→ read_file({ path: "package.json" })  # 直接读取，安全

模型: "删除所有文件"
→ 没有delete工具！模型会拒绝或要求创建新工具
```

## 四个基础工具

| 工具 | 用途 | 示例 |
|------|------|------|
| `bash` | 运行命令 | git status, npm test |
| `read_file` | 读取文件 | 查看源代码 |
| `write_file` | 创建/覆盖 | 新建文件 |
| `edit_file` | 精确编辑 | 替换函数 |

## 代码实现要点

### 1. 工具定义

```typescript
const read_fileTool: Anthropic.Tool = {
  name: 'read_file',
  description: '读取文件内容。返回UTF-8文本。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件的相对路径' },
      limit: { type: 'integer', description: '最大读取行数' }
    },
    required: ['path']
  }
};
```

**关键点**：
- `description` 是模型的唯一使用说明
- `input_schema` 定义类型和必填字段
- 好的描述减少错误调用

### 2. 路径安全

```typescript
function safePath(path: string): string {
  const resolved = `${WORKDIR}/${path}`;
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`路径超出工作区: ${path}`);
  }
  return resolved;
}
```

防止：
```typescript
read_file("../../../etc/passwd")  // 被阻止！
```

### 3. Bun API

```typescript
// 读取文件
const file = Bun.file(path);
const content = await file.text();

// 写入文件
await Bun.write(path, content);

// 运行命令
const proc = Bun.spawn(['bash', '-c', cmd], {
  stdout: 'pipe', stderr: 'pipe'
});
const output = await new Response(proc.stdout).text();
```

为什么不用Node.js？
- Bun更快（子代理启动快10倍）
- 原生TypeScript
- 更简洁的API

### 4. 精确编辑

```typescript
// edit_file vs write_file
edit_file(path, "function old() {}", "function new() {}")
// 只替换精确匹配，更安全、更高效

write_file(path, entireNewContent)
// 必须输出整个文件，容易出错
```

## 运行示例

```bash
$ bun run src/v1_basic_agent.ts

你：读取package.json并告诉我项目依赖

> read_file: {"path":"package.json"}
  {
    "name": "my-project",
    "dependencies": {
      "@anthropic-ai/sdk": "^0.71.2"
    }
  }

项目使用@anthropic-ai/sdk作为唯一依赖。

你：在src/目录创建一个hello.ts文件

> write_file: {"path":"src/hello.ts","content":"console.log('Hello');"}
  向 src/hello.ts 写入了 24 字节

已创建src/hello.ts，包含hello world代码。

你：把hello.ts的console.log改成console.warn

> read_file: {"path":"src/hello.ts"}

> edit_file: {
    "path":"src/hello.ts",
    "old_text":"console.log('Hello');",
    "new_text":"console.warn('Hello');"
  }
  已编辑 src/hello.ts

已将console.log改为console.warn。
```

## 架构图

```
┌──────────────────────────────────────────────────────────┐
│                       用户输入                             │
└───────────────────────┬──────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│                    agentLoop(messages)                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │              调用模型 (messages, TOOLS)           │   │
│  └───────────────┬──────────────────────────────────┘   │
│                  ▼                                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │                 解析响应                          │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │  ToolUseBlock? → executeTool()             │ │   │
│  │  │    ├─ bash      → runBash()                │ │   │
│  │  │    ├─ read_file → runRead()                │ │   │
│  │  │    ├─ write_file→ runWrite()               │ │   │
│  │  │    └─ edit_file → runEdit()                │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  │                                                   │   │
│  │  stop_reason === 'tool_use'? 继续循环             │   │
│  │  否则? 返回                                       │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

## 关键洞察

### 1. 工具即能力边界

```typescript
// 没有delete工具 = 不能删除
// 没有network工具 = 不能发HTTP请求
// 只暴露需要的工具
```

### 2. 描述即说明书

模型只通过`description`理解工具用途。好的描述：

```typescript
// ❌ 差
description: "编辑文件"

// ✅ 好
description: "通过替换精确文本来编辑文件。old_text必须在文件中唯一。"
```

### 3. 输出截断很重要

```typescript
return output.slice(0, 50000);  // 防止上下文溢出
```

## 练习

1. **添加新工具**：实现一个`list_files`工具，使用`Bun.glob`

2. **改进edit_file**：添加`count`参数，允许替换第N次出现

3. **添加glob搜索**：实现一个搜索工具，支持模式匹配

## 对比v0

| 特性 | v0 | v1 |
|------|----|----|
| 工具数量 | 1 (bash) | 4 (结构化) |
| 安全性 | ❌ 危险命令 | ✅ 路径隔离 |
| 效率 | ❌ 子进程开销 | ✅ 直接文件操作 |
| 精确性 | ❌ 文本解析 | ✅ 类型化输入 |

## 下一步

v1版本可以工作了，但复杂任务时模型会"迷路"：

```
用户: "重构认证、添加测试、更新文档"
模型: [做A... 做C... 做B...] 顺序混乱！
```

下一章，我们将添加**TodoWrite**工具来让计划可见。
