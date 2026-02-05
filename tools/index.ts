import { BASH_TOOL, runBash} from './bash'
import { EDIT_FILE, runEdit } from './edit_file'
import { READ_FILE, runRead } from './read_file'
import { runWrite, WRITE_FILE } from './write_file'
import {runTodo, TODO_WRITE } from './todo'
import type { TodoItem } from '../manager/TodoManager'
export const Tools = [
  BASH_TOOL,
  READ_FILE,
  WRITE_FILE,
  EDIT_FILE,
  TODO_WRITE
]


/**
 * 将工具调用分发到相应的实现。
 * 
 * 这是模型工具调用和实际执行之间的桥梁。
 * 每个工具都返回一个字符串结果，返回给模型。
 */
export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch(name){
    case 'bash':
      return runBash(args.command as string)
    case 'read_file':
      return runRead(args.path as string, args.limit as number | undefined)
    case 'write_file':
      return runWrite(args.path as string, args.content as string)
    case 'edit_file':
      return runEdit(args.path as string, args.old_text as string, args.new_text as string)
    case "todo_write":
      return runTodo(args.items as TodoItem[])
    default:
      return `未知工具：${name}`
  }
}