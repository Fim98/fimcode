import type Anthropic from "@anthropic-ai/sdk";
import { safePath } from "../utils/safePath";

export const WRITE_FILE: Anthropic.Tool = {
  name: 'write_file',
  description: '向文件写入内容。如需要会创建父目录。',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件的相对路径',
      },
      content: {
        type: 'string',
        description: '要写入的内容'
      }
    },
    required: ['path', 'content']
  }
}

/**
 * 将内容写入文件，如需要会创建父目录。
 * 
 * 这用于完整的文件创建/重写。
 * 对于部分编辑，请使用edit_file。
 */
export async function runWrite(path: string, content: string): Promise<string> {
  try {
    const safe = safePath(path);
    
    // 使用Bun.write API写入文件
    await Bun.write(safe, content);
    
    return `向 ${path} 写入了 ${content.length} 字节`;
  } catch (error) {
    return `错误：${error instanceof Error ? error.message : String(error)}`;
  }
}