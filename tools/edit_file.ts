import type Anthropic from "@anthropic-ai/sdk";
import { safePath } from "../utils/safePath";

export const EDIT_FILE: Anthropic.Tool = {
  name: 'edit_file',
  description: '替换文件中的精确文本。用于精确编辑。',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件的相对路径'
      },
      old_text: {
        type: 'string',
        description: '要查找的精确文本（必须精确匹配）'
      },
      new_text: {
        type: 'string',
        description: '替换文本'
      }
    },
    required: ['path', 'old_text', 'new_text']
  }
}


/**
 * 替换文件中的精确文本（精确编辑）。
 * 
 * 使用精确字符串匹配 - old_text必须逐字出现。
 * 只替换第一次出现以防止意外大量更改。
 */
export async function runEdit(path: string, oldText: string, newText: string): Promise<string> {
  try {
    const safe = safePath(path);
    
    const file = Bun.file(safe);
    const content = await file.text();

    if (!content.includes(oldText)) {
      return `错误：在 ${path} 中未找到文本`;
    }

    // 只替换第一次出现（安全）
    const newContent = content.replace(oldText, newText);
    await Bun.write(safe, newContent);
    
    return `已编辑 ${path}`;
  } catch (error) {
    return `错误：${error instanceof Error ? error.message : String(error)}`;
  }
}