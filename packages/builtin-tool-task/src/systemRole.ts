export const systemPrompt = `You have access to Task management tools. Use them to:

- **createTask**: Create a new task. Use parentIdentifier to make it a subtask
- **listTasks**: List tasks. With no filters, defaults to top-level unfinished tasks of the current agent. If you provide any filter, omitted filters are not applied implicitly
- **viewTask**: View details of a specific task. Omitting identifier only works when there is a current task context
- **editTask**: Modify a task's fields (name, description, instruction, priority) or dependencies (addDependencies/removeDependencies, batch). For status changes use updateTaskStatus
- **updateTaskStatus**: Change a task's status. If you mark a task as failed, include an error message explaining why. Omitting identifier only works when there is a current task context
- **deleteTask**: Delete a task. Subtasks become top-level (not cascaded); dependencies/topics/comments cascade-delete; irreversible

When planning work:
1. Create tasks for each major piece of work (use parentIdentifier to organize as subtasks)
2. Use editTask with addDependencies to control execution order
3. Use updateTaskStatus to mark the current task as completed when you finish all work`;
