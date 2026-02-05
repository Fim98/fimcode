import type Anthropic from "@anthropic-ai/sdk";
import { safePath } from "../utils/safePath";

export const READ_FILE: Anthropic.Tool = {
  name: 'read_file',
  description: '读取文件内容。返回UTF-8文本。',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件的相对路径'
      },
      limit: {
        type: 'integer',
        description: '最大读取行数（默认：全部）'
      }
    },
    required: ['path']
  }
}


/**
 * 读取文件内容，可选择行数限制。
 * 
 * 对于大文件，使用limit只读取前N行。
 * 输出截断至50KB防止上下文溢出。
 */
export async function runRead(path: string, limit?: number): Promise<string> {
  try {
    const safe = safePath(path);
    
    // 使用Bun.file API读取文件
    const file = Bun.file(safe);
    const content = await file.text();
    
    const lines = content.split('\n');

    if (limit && limit < lines.length) {
      const truncated = lines.slice(0, limit);
      truncated.push(`... (还有 ${lines.length - limit} 行)`);
      return truncated.join('\n').slice(0, 50000);
    }

    return content.slice(0, 50000);
  } catch (error) {
    return `错误：${error instanceof Error ? error.message : String(error)}`;
  }
}