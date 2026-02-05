// 待办事项状态
type TodoStatus = 'pending' | 'in_progress' | 'completed'

// 单个待办事项
export interface TodoItem {
  content: string;  // 任务描述
  status: TodoStatus; // 当前状态
  activeForm: string;  // 正在进行的描述（现在时）
}

/**
 * 管理带强制约束的结构化任务列表。
 * 
 * 关键设计决策：
 * 1. 最多20项：防止模型创建无尽的列表
 * 2. 仅一项进行中：强制专注 - 一次只能做一件事
 * 3. 必填字段：每项需要 content、status和activeForm
 * 
 * activeForm字段值的解释：
 * - 它是正在发生的事情和现在时形式
 * - 在状态为"in_progress"时显示
 * - 示例：content="添加测试", activeForm="正在添加单元测试..."
 * 
 * 这提供了对代理正在做什么的实时可见性
 */
export class TodoManager {
  private items: TodoItem[] = []

  /**
   * 验证并更新待办事项列表
   */
  update(items: TodoItem[]): string{
    const validated: TodoItem[] = []
    let inProgressCount = 0

    for(let i =0; i<items.length; i++){
      const item = items[i]

      // 提取并验证字段
      const content = String(item?.content || '').trim()
      const status = (item?.status || 'pending').toLocaleLowerCase() as TodoStatus 
      const activeForm = String(item?.activeForm || '').trim()

      // 验证检查
      if (!content) {
        throw new Error(`第 ${i} 项: 需要内容 (content)`);
      }
      if (!['pending', 'in_progress', 'completed'].includes(status)) {
        throw new Error(`第 ${i} 项: 无效状态 '${status}'`);
      }
      if (!activeForm) {
        throw new Error(`第 ${i} 项: 需要 activeForm`);
      }

      if(status === 'in_progress'){
        inProgressCount++
      }

      validated.push({content, status, activeForm})
    }

    // 强制执行约束
    if(validated.length > 20){
      throw new Error('最多允许20项待办事项')
    }
    if(inProgressCount>1){
      throw new Error('同一时间只能有一项任务进行中(in_progress)')
    }
    this.items = validated
    return this.render()
  }

   /**
   * 将待办事项列表渲染为人类可读的文本。
   * 
   * 格式:
   *   [x] 已完成的任务
   *   [>] 进行中的任务 <- 正在做某事...
   *   [ ] 待处理的任务
   * 
   *   (2/3 已完成)
   * 
   * 这个渲染后的文本是模型作为工具结果看到的内容。
   * 然后它可以根据当前状态更新列表。
   */
  render(): string {
    if(this.items.length === 0){
      return '没有待办事项。'
    }

    const lines: string[] = []

    for(const item of this.items){
      if(item.status === 'completed'){
        lines.push(`[x] ${item.content}`)
      }else if(item.status === 'in_progress'){
        lines.push(`[>] ${item.content} <- ${item.activeForm}`)
      }else {
        lines.push(`[ ] ${item.content}`)
      }
    }

    const completed = this.items.filter(t=> t.status === 'completed').length
    lines.push(`\n(${completed}/${this.items.length} 已完成)`)

    return lines.join('\n')
  }

  /**
   * 获取当前待办事项数量
   */
  get count(): number{
    return this.items.length
  }
}

