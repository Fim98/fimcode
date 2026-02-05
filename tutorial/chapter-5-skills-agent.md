# 第5章: 知识外化 - 添加技能系统

## 核心理念

**知识存储在文件中，而非模型参数里**

v3有强大的子代理机制，但模型缺乏领域知识：

```
用户: "处理这个PDF文件"
v3: [不知道用什么库] 
    "我应该用pdftotext、PyMuPDF还是pdf.js？"
```

## 范式转变

### 传统AI：知识在模型中

```
要教模型新技能:
1. 收集训练数据
2. 微调模型
3. 部署新模型

成本: $10K-$1M+
时间: 数周
需要: ML专业知识、GPU集群
```

### 技能系统：知识在文件中

```
要教模型新技能:
1. 编写 skills/pdf/SKILL.md

成本: 免费
时间: 分钟
需要: Markdown编辑器
```

这就像**热插拔LoRA适配器，无需训练**！

## 工具 vs 技能

| 概念 | 含义 | 示例 |
|------|------|------|
| **工具** | 能力 | bash, read_file, write |
| **技能** | 知道怎么做 | PDF处理、MCP开发 |

工具是"你能做什么"，技能是"你知道怎么做"。

## 渐进式披露

```
第1层: 元数据 (~100 tokens/技能)
      系统提示中始终可见
      - pdf: 处理PDF文件

第2层: 技能内容 (~2000 tokens)
      调用Skill工具时注入
      # PDF处理技能
      ## 读取PDF
      使用pdftotext...

第3层: 资源 (无限)
      技能目录中的文件
      scripts/, references/, assets/
```

## SKILL.md 格式

```yaml
---
name: pdf
description: 处理 PDF 文件。用于读取、创建或合并 PDF。
---

# PDF 处理技能

## 读取 PDF

使用 pdftotext 快速提取:
\`\`\`bash
pdftotext input.pdf -
\`\`\`

对于更复杂的解析，使用 PyMuPDF:
\`\`\`python
import fitz
doc = fitz.open("file.pdf")
text = doc.get_text()
\`\`\`

## 创建 PDF

使用 reportlab 或 weasyprint...
```

## 代码实现要点

### 1. SkillLoader 类

```typescript
class SkillLoader {
  private skills: Map<string, Skill> = new Map();

  loadSkills(): void {
    // 扫描 skills/ 目录
    // 解析每个 SKILL.md
    // 提取 YAML 前置元数据
  }

  getDescriptions(): string {
    // 返回第1层 - 名称和描述
    // "- pdf: 处理PDF文件"
  }

  getSkillContent(name: string): string | null {
    // 返回第2层 - 完整内容
    // 包括资源提示
  }
}
```

### 2. YAML 前置元数据解析

```typescript
private parseSkillMd(path: string): Skill | null {
  const content = Bun.file(path).text();
  
  // 匹配 --- 标记
  const match = content.match(/^---\s*\n(.*?)\n---\s*\n(.*)$/s);
  if (!match) return null;

  const [, frontmatter, body] = match;
  
  // 解析 key: value
  const metadata = {};
  for (const line of frontmatter.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    metadata[key.trim()] = valueParts.join(':').trim();
  }

  return {
    name: metadata.name,
    description: metadata.description,
    body,
    path,
    dir
  };
}
```

### 3. 缓存友好的注入

```typescript
function runSkill(skillName: string): string {
  const content = SKILLS.getSkillContent(skillName);
  
  return `<skill-loaded name="${skillName}">
${content}
</skill-loaded>

按照上面技能的说明完成用户的任务。`;
}
```

**关键**：作为`tool_result`注入，不是修改系统提示！

```
❌ 错误: 修改 system prompt
   system = SYSTEM + skillContent
   → 缓存失效，成本增加 20-50倍

✅ 正确: 附加为 tool_result
   messages.append({ role: 'user', content: skillContent })
   → 前缀不变，缓存命中
```

### 4. Skill 工具定义

```typescript
const skillTool: Tool = {
  name: 'Skill',
  description: `加载技能以获取专门知识。

可用技能:
${SKILLS.getDescriptions()}

使用时机:
- 当任务匹配技能描述时`,
  input_schema: {
    type: 'object',
    properties: {
      skill: { type: 'string' }
    },
    required: ['skill']
  }
};
```

## 运行示例

```bash
$ bun run src/v4_skills_agent.ts

🤖 Mini Claude Code v4 (带技能) - /project
技能: pdf, mcp-builder
代理类型: explore, code, plan

你：读取 data/report.pdf 并总结关键点

> 正在加载技能: pdf
  技能已加载 (2341 字符)

我会使用 PDF 处理技能来读取这个文件。

> bash: {"command":"pdftotext data/report.pdf -"}
  [PDF文本输出]

> bash: {"command":"pdftotext data/report.pdf - | head -n 50"}
  [前50行]

根据PDF内容，关键点是：
1. ...
2. ...
```

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    用户: "处理PDF"                       │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│              系统提示 (包含技能元数据)                    │
│  可用技能:                                               │
│  - pdf: 处理PDF文件                                      │
│  - mcp-builder: 构建MCP服务器                            │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│         模型识别任务匹配 "pdf" 技能                       │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│              调用 Skill(pdf) 工具                        │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│            SkillLoader.getSkillContent()                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │  读取 skills/pdf/SKILL.md                        │   │
│  │  附加资源提示 (scripts/, references/)             │   │
│  └─────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│          作为 tool_result 注入技能内容                    │
│  <skill-loaded name="pdf">                              │
│  # PDF处理技能                                           │
│  ... 详细说明 ...                                        │
│  </skill-loaded>                                         │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│             模型现在有领域知识，执行任务                   │
└─────────────────────────────────────────────────────────┘
```

## 关键洞察

### 1. 知识外化

```
传统: 知识在模型参数中
→ 需要重新训练来更新

技能: 知识在 SKILL.md 中
→ 编辑文件即更新
```

### 2. 缓存友好性

```
系统提示更改 → 缓存失效 → 成本 20-50x
工具结果附加 → 缓存保持 → 成本不变
```

这就是生产系统控制成本的关键！

### 3. 社区可贡献

```
任何人都可以创建技能:
1. 创建 skills/my-skill/SKILL.md
2. 写入YAML元数据 + Markdown内容
3. 提交PR或复制到项目

无需重新训练模型！
```

## 技能目录结构

```
skills/
├── pdf/
│   ├── SKILL.md              # 必需
│   ├── scripts/              # 可选
│   │   └── extract-pdf.py
│   └── references/           # 可选
│       └── pdftotext-manual.txt
├── mcp-builder/
│   ├── SKILL.md
│   └── templates/
│       └── server-template.ts
└── code-review/
    ├── SKILL.md
    └── checklists/
        └── security-checklist.md
```

## 练习

1. **创建测试技能**：编写 `skills/testing/SKILL.md`，包含如何运行不同类型测试的说明

2. **添加脚本引用**：在技能中引用 `scripts/` 目录下的实际可执行脚本

3. **多语言技能**：创建一个包含Python、TypeScript、Go三种语言的项目结构指南

## 完整对比

| 特性 | v0 | v1 | v2 | v3 | v4 |
|------|----|----|----|----|----|
| 工具 | bash | 4个结构化 | 4个 | 4个+Task | 4个+Task+Skill |
| 规划 | ❌ | ❌ | ✅ TodoWrite | ✅ | ✅ |
| 子代理 | ❌ | ❌ | ❌ | ✅ Task | ✅ |
| 领域知识 | ❌ | ❌ | ❌ | ❌ | ✅ Skill |
| 代码行数 | ~50 | ~200 | ~300 | ~450 | ~550 |

## 恭喜！

你已经完成了从0到1的AI编码代理构建之旅！

你学到了：
- **Agent Loop**: 代理的核心模式
- **结构化工具**: 安全高效的工具设计
- **任务规划**: TodoWrite让计划可见
- **子代理**: 隔离上下文处理复杂任务
- **技能系统**: 知识外化，无需训练

这些正是 Claude Code、Cursor Agent 等工具的核心原理。

## 下一步

1. **扩展技能库**：为你的工作流创建自定义技能

2. **添加更多工具**：实现网络请求、数据库操作等

3. **优化性能**：实现请求批流、并行子代理

4. **构建UI**：添加TUI或Web界面

5. **部署**：打包为CLI工具供团队使用

## 资源

- [Anthropic API 文档](https://docs.anthropic.com/)
- [Bun 文档](https://bun.sh/docs)
- [Claude Code 文档](https://code.claude.com/docs)

感谢学习！
