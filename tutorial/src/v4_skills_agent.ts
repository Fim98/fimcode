#!/usr/bin/env bun
/**
 * v4_skills_agent.ts - Mini Claude Code: 技能机制 (~550行)
 * 
 * 核心理念: "知识外化"
 * =============================================
 * v3 给了我们用于任务分解的子代理。但还有一个更深层的问题:
 * 
 *     模型如何知道如何处理特定领域的任务?
 * 
 * - 处理 PDF? 它需要知道 pdftotext vs PyMuPDF
 * - 构建 MCP 服务器? 它需要协议规范和最佳实践
 * - 代码审查? 它需要一个系统化的检查清单
 * 
 * 这些知识不是工具——这是专业知识。技能通过让模型按需加载
 * 领域知识来解决这个问题。
 * 
 * 范式转变: 知识外化
 * ------------------------------------
 * 传统 AI: 知识锁定在模型参数中
 *   - 要教授新技能: 收集数据 -> 训练 -> 部署
 *   - 成本: $10K-$1M+, 时间周期: 数周
 *   - 需要 ML 专业知识、GPU 集群
 * 
 * 技能: 知识存储在可编辑的文件中
 *   - 要教授新技能: 编写一个 SKILL.md 文件
 *   - 成本: 免费, 时间周期: 分钟
 *   - 任何人都可以做到
 * 
 * 这就像热插拔 LoRA 适配器而无需任何训练!
 * 
 * 工具 vs 技能:
 * ---------------
 *     | 概念     | 模型能做什么          | 示例                          |
 *     |-----------|----------------------|------------------------------|
 *     | **工具**  | 能力                 | bash, read_file, write       |
 *     | **技能**  | 模型知道怎么做       | PDF 处理, MCP 开发           |
 * 
 * 工具是能力。技能是知识。
 * 
 * 渐进式披露:
 * ----------------------
 *     第 1 层: 元数据 (始终加载)      ~100 tokens/技能
 *              名称 + 描述
 * 
 *     第 2 层: SKILL.md 主体 (触发时)  ~2000 tokens
 *              详细说明
 * 
 *     第 3 层: 资源 (按需)             无限
 *              scripts/, references/, assets/
 * 
 * 这保持上下文简洁，同时允许任意深度。
 * 
 * SKILL.md 标准:
 * -----------------
 *     skills/
 *     |-- pdf/
 *     |   |-- SKILL.md          # 必需: YAML 前置元数据 + Markdown 主体
 *     |-- mcp-builder/
 *     |   |-- SKILL.md
 *     |   |-- references/       # 可选: 文档、规范
 *     |-- code-review/
 *         |-- SKILL.md
 *         |-- scripts/          # 可选: 辅助脚本
 * 
 * 缓存友好的注入:
 * --------------------------
 * 关键洞察: 技能内容放入 tool_result (用户消息)，
 * 不是系统提示。这保留了提示缓存!
 * 
 *     错误: 每次编辑系统提示 (缓存失效, 20-50x 成本)
 *     正确: 附加技能作为工具结果 (前缀不变, 缓存命中)
 * 
 * 这就是生产环境 Claude Code 的工作方式——也是它具有成本效益的原因。
 * 
 * 用法：
 *     bun run src/v4_skills_agent.ts
 */

import Anthropic, { Tool } from '@anthropic-ai/sdk';

// =============================================================================
// 配置
// =============================================================================

const WORKDIR = process.cwd();
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-5';
const SKILLS_DIR = `${WORKDIR}/tutorial/skills`;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL
});

// =============================================================================
// SkillLoader - v4 的核心新增功能
// =============================================================================

/**
 * 技能数据结构
 */
interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  dir: string;
}

/**
 * 从 SKILL.md 文件加载和管理技能。
 * 
 * 技能是一个包含以下内容的文件夹:
 * - SKILL.md (必需): YAML 前置元数据 + markdown 说明
 * - scripts/ (可选): 模型可以运行的辅助脚本
 * - references/ (可选): 附加文档
 * - assets/ (可选): 模板、输出文件
 * 
 * SKILL.md 格式:
 * ----------------
 *     ---
 *     name: pdf
 *     description: 处理 PDF 文件。用于读取、创建或合并 PDF。
 *     ---
 * 
 *     # PDF 处理技能
 * 
 *     ## 读取 PDF
 * 
 *     使用 pdftotext 快速提取:
 *     ```bash
 *     pdftotext input.pdf -
 *     ```
 *     ...
 * 
 * YAML 前置元数据提供元数据 (名称、描述)。
 * Markdown 主体提供详细说明。
 */
class SkillLoader {
  private skills: Map<string, Skill> = new Map();

  constructor(private skillsDir: string) {
    this.loadSkills();
  }

  /**
   * 将 SKILL.md 文件解析为元数据和主体。
   * 
   * 返回包含以下内容的字典: name, description, body, path, dir
   * 如果文件不符合格式则返回 null。
   */
  private parseSkillMd(path: string): Skill | null {
    const content = Bun.file(path).text() as unknown as string;

    // 匹配 --- 标记之间的 YAML 前置元数据
    const yamlMatch = content.match(/^---\s*\n(.*?)\n---\s*\n(.*)$/s);
    if (!yamlMatch) {
      return null;
    }

    const [, frontmatter, body] = yamlMatch;

    // 解析类似 YAML 的前置元数据 (简单的 key: value)
    const metadata: Record<string, string> = {};
    for (const line of frontmatter.trim().split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
        metadata[key] = value;
      }
    }

    // 需要 name 和 description
    if (!metadata.name || !metadata.description) {
      return null;
    }

    return {
      name: metadata.name,
      description: metadata.description,
      body: body.trim(),
      path,
      dir: path.replace(/\/SKILL\.md$/, '')
    };
  }

  /**
   * 扫描技能目录并加载所有有效的 SKILL.md 文件。
   * 
   * 启动时只加载元数据 - 主体按需加载。
   * 这保持了初始上下文的简洁。
   */
  loadSkills(): void {
    const skillsPath = this.skillsDir;

    try {
      const entries = Array.from(
        new Bun.Glob('*').scanSync({ cwd: skillsPath, onlyFiles: false })
      );

      for (const entry of entries) {
        const skillDir = `${skillsPath}/${entry}`;
        const skillMdPath = `${skillDir}/SKILL.md`;

        try {
          const file = Bun.file(skillMdPath);
          if (file.exists) {
            const skill = this.parseSkillMd(skillMdPath);
            if (skill) {
              this.skills.set(skill.name, skill);
            }
          }
        } catch {
          // 跳过无效目录
        }
      }
    } catch {
      // 技能目录不存在
    }
  }

  /**
   * 为系统提示生成技能描述。
   * 
   * 这是第 1 层 - 只有名称和描述，每个技能 ~100 tokens。
   * 完整内容 (第 2 层) 仅在调用 Skill 工具时加载。
   */
  getDescriptions(): string {
    if (this.skills.size === 0) {
      return '(没有可用的技能)';
    }

    return Array.from(this.skills.entries())
      .map(([name, skill]) => `- ${name}: ${skill.description}`)
      .join('\n');
  }

  /**
   * 获取完整技能内容以注入。
   * 
   * 这是第 2 层 - 完整的 SKILL.md 主体，加上任何可用的
   * 资源 (第 3 层提示)。
   * 
   * 如果找不到技能则返回 null。
   */
  getSkillContent(name: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) {
      return null;
    }

    let content = `# 技能: ${skill.name}\n\n${skill.body}`;

    // 列出可用的资源 (第 3 层提示)
    const resources: string[] = [];

    for (const [folder, label] of [
      ['scripts', '脚本'],
      ['references', '参考文档'],
      ['assets', '资源']
    ] as const) {
      const folderPath = `${skill.dir}/${folder}`;
      try {
        const files = Array.from(
          new Bun.Glob('*').scanSync({ cwd: folderPath, onlyFiles: true })
        );
        if (files.length > 0) {
          resources.push(`${label}: ${files.join(', ')}`);
        }
      } catch {
        // 文件夹不存在
      }
    }

    if (resources.length > 0) {
      content += `\n\n**${skill.dir} 中可用的资源:**\n`;
      content += resources.map(r => `- ${r}`).join('\n');
    }

    return content;
  }

  /**
   * 返回可用技能名称的列表。
   */
  listSkills(): string[] {
    return Array.from(this.skills.keys());
  }
}

// 全局技能加载器实例
const SKILLS = new SkillLoader(SKILLS_DIR);

// =============================================================================
// 代理类型注册表 (来自 v3)
// =============================================================================

type AgentType = 'explore' | 'code' | 'plan';

interface AgentConfig {
  description: string;
  tools: string[] | '*';
  prompt: string;
}

const AGENT_TYPES: Record<AgentType, AgentConfig> = {
  explore: {
    description: '用于探索代码、查找文件、搜索的只读代理',
    tools: ['bash', 'read_file'],
    prompt: '你是一个探索代理。搜索和分析，但绝不修改文件。返回简洁的摘要。'
  },
  code: {
    description: '用于实现功能和修复错误的完整代理',
    tools: '*',
    prompt: '你是一个编码代理。高效地实现请求的更改。'
  },
  plan: {
    description: '用于设计实现策略的规划代理',
    tools: ['bash', 'read_file'],
    prompt: '你是一个规划代理。分析代码库并输出编号的实现计划。不要进行更改。'
  }
};

function getAgentDescriptions(): string {
  return Object.entries(AGENT_TYPES)
    .map(([name, cfg]) => `- ${name}: ${cfg.description}`)
    .join('\n');
}

// =============================================================================
// TodoManager (来自 v2)
// =============================================================================

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm: string;
}

class TodoManager {
  private items: TodoItem[] = [];

  update(items: TodoItem[]): string {
    const validated: TodoItem[] = [];
    let inProgress = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const content = String(item.content || '').trim();
      const status = (item.status || 'pending').toLowerCase() as TodoStatus;
      const active = String(item.activeForm || '').trim();

      if (!content || !active) {
        throw new Error(`Item ${i}: content and activeForm required`);
      }
      if (!['pending', 'in_progress', 'completed'].includes(status)) {
        throw new Error(`Item ${i}: invalid status`);
      }
      if (status === 'in_progress') inProgress++;

      validated.push({ content, status, activeForm: active });
    }

    if (inProgress > 1) {
      throw new Error('Only one task can be in_progress');
    }

    this.items = validated.slice(0, 20);
    return this.render();
  }

  render(): string {
    if (this.items.length === 0) return 'No todos.';

    const lines = this.items.map(t => {
      const mark = t.status === 'completed' ? '[x]'
        : t.status === 'in_progress' ? '[>]'
        : '[ ]';
      return `${mark} ${t.content}`;
    });

    const done = this.items.filter(t => t.status === 'completed').length;
    return lines.join('\n') + `\n(${done}/${this.items.length} done)`;
  }
}

const TODO = new TodoManager();

// =============================================================================
// 系统提示 - 为 v4 更新
// =============================================================================

const SYSTEM = `你是一个编码代理，位于 ${WORKDIR}。

循环: 规划 -> 使用工具行动 -> 报告。

**可用技能** (使用 Skill 工具调用，当任务匹配时):
${SKILLS.getDescriptions()}

**可用的子代理** (使用 Task 工具进行专注的子任务):
${getAgentDescriptions()}

规则:
- 当任务匹配技能描述时立即使用 Skill 工具
- 对于需要专注探索或实现的子任务使用 Task 工具
- 使用 TodoWrite 跟踪多步骤工作
- 优先使用工具而不是解释。行动，而不仅仅是解释。
- 完成后，总结发生了什么变化。`;

// =============================================================================
// 工具定义
// =============================================================================

const bashTool: Tool = {
  name: 'bash',
  description: '运行 shell 命令。',
  input_schema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command']
  }
};

const read_fileTool: Tool = {
  name: 'read_file',
  description: '读取文件内容。',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' }, limit: { type: 'integer' } },
    required: ['path']
  }
};

const write_fileTool: Tool = {
  name: 'write_file',
  description: '写入文件。',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content']
  }
};

const edit_fileTool: Tool = {
  name: 'edit_file',
  description: '替换文件中的文本。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_text: { type: 'string' },
      new_text: { type: 'string' }
    },
    required: ['path', 'old_text', 'new_text']
  }
};

const todoWriteTool: Tool = {
  name: 'TodoWrite',
  description: '更新任务列表。',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeForm: { type: 'string' }
          },
          required: ['content', 'status', 'activeForm']
        }
      }
    },
    required: ['items']
  }
};

const taskTool: Tool = {
  name: 'Task',
  description: `生成一个子代理以处理专注的子任务。

代理类型:
${getAgentDescriptions()}`,
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      prompt: { type: 'string' },
      agent_type: { type: 'string', enum: Object.keys(AGENT_TYPES) }
    },
    required: ['description', 'prompt', 'agent_type']
  }
};

// v4 新增: 技能工具
const skillTool: Tool = {
  name: 'Skill',
  description: `加载技能以获取任务的专门知识。

可用技能:
${SKILLS.getDescriptions()}

使用时机:
- 当用户任务匹配技能描述时立即使用
- 在尝试特定领域工作之前 (PDF、MCP 等)

技能内容将被注入到对话中，给你详细的说明和对资源的访问权限。`,
  input_schema: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: '要加载的技能名称'
      }
    },
    required: ['skill']
  }
};

const BASE_TOOLS: Tool[] = [
  bashTool,
  read_fileTool,
  write_fileTool,
  edit_fileTool,
  todoWriteTool
];

const ALL_TOOLS: Tool[] = [
  ...BASE_TOOLS,
  taskTool,
  skillTool  // v4 新增
];

function getToolsForAgent(agentType: AgentType): Tool[] {
  const allowed = AGENT_TYPES[agentType].tools;
  if (allowed === '*') {
    return BASE_TOOLS;
  }
  return BASE_TOOLS.filter(t => allowed.includes(t.name));
}

// =============================================================================
// 工具实现
// =============================================================================

function safePath(path: string): string {
  const resolved = `${WORKDIR}/${path}`.replace(/\/+/g, '/');
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`路径超出工作区: ${path}`);
  }
  return resolved;
}

async function runBash(command: string): Promise<string> {
  if (['rm -rf /', 'sudo', 'shutdown'].some(d => command.includes(d))) {
    return '错误: 危险命令';
  }
  try {
    const r = Bun.spawn(['bash', '-c', command], {
      cwd: WORKDIR,
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const output = await new Response(r.stdout).text();
    const error = await new Response(r.stderr).text();
    return ((output + error).trim() || '(无输出)').slice(0, 50000);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runRead(path: string, limit?: number): Promise<string> {
  try {
    const safe = safePath(path);
    const lines = (await Bun.file(safe).text()).split('\n');
    if (limit) {
      const truncated = lines.slice(0, limit);
      truncated.push(`... (还有 ${lines.length - limit} 行)`);
      return truncated.join('\n').slice(0, 50000);
    }
    return lines.join('\n').slice(0, 50000);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runWrite(path: string, content: string): Promise<string> {
  try {
    const safe = safePath(path);
    await Bun.write(safe, content);
    return `写入 ${content.length} 字节到 ${path}`;
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runEdit(path: string, oldText: string, newText: string): Promise<string> {
  try {
    const safe = safePath(path);
    const text = await Bun.file(safe).text();
    if (!text.includes(oldText)) {
      return `错误: 文本在 ${path} 中未找到`;
    }
    await Bun.write(safe, text.replace(oldText, newText, 1));
    return `已编辑 ${path}`;
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function runTodo(items: TodoItem[]): string {
  try {
    return TODO.update(items);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 加载技能并将其注入对话。
 * 
 * 这是关键机制:
 * 1. 获取技能内容 (SKILL.md 主体 + 资源提示)
 * 2. 用 <skill-loaded> 标签包装返回
 * 3. 模型将此作为 tool_result (用户消息) 接收
 * 4. 模型现在"知道"如何完成任务
 * 
 * 为什么是 tool_result 而不是系统提示?
 * - 系统提示更改会使缓存失效 (20-50x 成本增加)
 * - 工具结果附加到末尾 (前缀不变, 缓存命中)
 * 
 * 这就是生产系统如何保持成本效益。
 */
function runSkill(skillName: string): string {
  const content = SKILLS.getSkillContent(skillName);

  if (content === null) {
    const available = SKILLS.listSkills().join(', ') || '无';
    return `错误: 未知的技能 '${skillName}'。可用技能: ${available}`;
  }

  // 用标签包装以便模型知道这是技能内容
  return `<skill-loaded name="${skillName}">
${content}
</skill-loaded>

按照上面技能的说明完成用户的任务。`;
}

async function runTask(
  description: string,
  prompt: string,
  agentType: AgentType
): Promise<string> {
  const startTime = Date.now();
  let toolCount = 0;

  process.stdout.write(`  [${agentType}] ${description} ...`);

  const config = AGENT_TYPES[agentType];
  const subSystem = `你是一个在 ${WORKDIR} 的 ${agentType} 子代理。

${config.prompt}

完成任务并返回清晰、简洁的摘要。`;

  const subTools = getToolsForAgent(agentType);
  const subMessages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt }
  ];

  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      system: subSystem,
      messages: subMessages,
      tools: subTools,
      max_tokens: 8000
    });

    if (response.stop_reason !== 'tool_use') break;

    const toolCalls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tc of toolCalls) {
      toolCount++;
      const output = await executeTool(tc.name, tc.input);
      results.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: output
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r  [${agentType}] ${description} ... ${toolCount} 个工具, ${elapsed}s`);
    }

    subMessages.push({ role: 'assistant', content: response.content });
    subMessages.push({ role: 'user', content: results });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stdout.write(`\r  [${agentType}] ${description} - 完成 (${toolCount} 个工具, ${elapsed}s)\n`);

  const lastAssistant = subMessages.filter(m => m.role === 'assistant').pop();
  if (lastAssistant) {
    const finalText = lastAssistant.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    if (finalText.length > 0) {
      return finalText.map(b => b.text).join('\n');
    }
  }

  return '(子代理未返回文本)';
}

async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case 'bash':
      return runBash(args.command as string);
    case 'read_file':
      return runRead(args.path as string, args.limit as number | undefined);
    case 'write_file':
      return runWrite(args.path as string, args.content as string);
    case 'edit_file':
      return runEdit(args.path as string, args.old_text as string, args.new_text as string);
    case 'TodoWrite':
      return runTodo(args.items as TodoItem[]);
    case 'Task':
      return runTask(
        args.description as string,
        args.prompt as string,
        args.agent_type as AgentType
      );
    case 'Skill':
      return runSkill(args.skill as string);
    default:
      return `未知的工具: ${name}`;
  }
}

// =============================================================================
// 主代理循环
// =============================================================================

async function agentLoop(messages: Anthropic.MessageParam[]): Promise<void> {
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM,
      messages,
      tools: ALL_TOOLS,
      max_tokens: 8000
    });

    const toolCalls: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        process.stdout.write(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push(block);
      }
    }

    if (response.stop_reason !== 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      return;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tc of toolCalls) {
      // 不同工具类型的特殊显示
      if (tc.name === 'Task') {
        console.log(`\n> 任务: ${tc.input.description}`);
      } else if (tc.name === 'Skill') {
        console.log(`\n> 正在加载技能: ${tc.input.skill}`);
      } else {
        console.log(`\n> ${tc.name}`);
      }

      const output = await executeTool(tc.name, tc.input);

      // 技能工具显示摘要，而不是完整内容
      if (tc.name === 'Skill') {
        console.log(`  技能已加载 (${output.length} 字符)`);
      } else if (tc.name !== 'Task') {
        const preview = output.length > 200
          ? output.slice(0, 200) + '...'
          : output;
        console.log(`  ${preview}`);
      }

      results.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: output
      });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: results });
  }
}

// =============================================================================
// 主 REPL
// =============================================================================

async function main() {
  console.log(`\n🤖 Mini Claude Code v4 (带技能) - ${WORKDIR}`);
  console.log(`技能: ${SKILLS.listSkills().join(', ') || '无'}`);
  console.log(`代理类型: ${Object.keys(AGENT_TYPES).join(', ')}`);
  console.log('输入任务请求，或输入 "exit" 退出\n');

  const history: Anthropic.MessageParam[] = [];

  while (true) {
    try {
      const userInput = await prompt('你：')?.trim();

      if (!userInput || ['exit', 'quit', 'q'].includes(userInput.toLowerCase())) {
        break;
      }

      history.push({ role: 'user', content: userInput });

      try {
        await agentLoop(history);
      } catch (error) {
        console.error(`错误: ${error instanceof Error ? error.message : error}`);
      }

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

main().catch(console.error);
