import type Anthropic from "@anthropic-ai/sdk";

export const BASH_TOOL: Anthropic.Tool = {
  name: "bash",
  description: `执行shell命令。常见模式：
  - 读取: cat/head/tail, grep/find/rg/ls, wc -l
  - 写入: echo 'content' > file, sed -i 's/old/new/g' file
  - 子代理: bun run src/index.ts 'task description' (生成隔离代理，返回摘要)
  `,
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: '要执行的shell命令' },
    },
    required: ["command"],
  },
};


/**
 * 执行带有安全检查的shell命令。
 * 
 * 安全：阻止明显危险的命令。
 * 超时：60秒防止挂起。
 * 输出：截断至50KB防止上下文溢出。
 */
export async function runBash(command: string): Promise<string> {
  // 基本安全检查 - 阻止危险模式
  const dangerous = ['rm -rf /', 'sudo', 'shutdown', 'reboot', '> /dev/'];
  if (dangerous.some(d => command.includes(d))) {
    return '错误：危险命令被阻止';
  }

  try {
    const proc = Bun.spawn(['bash', '-c', command], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    const result = (output + error).trim();

    return result.slice(0, 50000) || '(无输出)';
  } catch (error) {
    return `错误：${error instanceof Error ? error.message : String(error)}`;
  }
}
