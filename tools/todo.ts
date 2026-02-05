import type Anthropic from "@anthropic-ai/sdk";
import { TodoManager, type TodoItem } from "../manager/TodoManager";

const TODO = new TodoManager()

export const TODO_WRITE: Anthropic.Tool = {
  name: 'todo_write',
  description: '更新任务列表。用于计划和跟踪进度。',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: '完整的任务列表(替换现有列表)',
        items: {
          type: 'object',
          properties: {
            content: {
             type: "string",
              description: '任务描述'
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: '任务状态'
            },
            activeForm: {
              type: 'string',
              description: '现在时动作，例如："正在读取文件"'
            }
          },
          required: ['content', 'status', 'activeForm']
        }
      }
    },
    required: ['items']
  }
}


/**
 * 更新待办事项列表。
 *
 * 模型发送一个完整的新列表（不是差异）。
 * 我们验证它并返回渲染后的视图。
 */
export function runTodo(items: TodoItem[]): string {
  try {
    return TODO.update(items);
  } catch (error) {
    return `错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}