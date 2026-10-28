// Fixture: input-side inference, injected function types and re-imported aliases are out of scope.
import type { TaskListItem } from '@/store/task/slices/list/initialState';
import { messageService } from '@/services/message';
import { taskService } from '@/services/task';

type CreateTaskParams = Parameters<typeof taskService.create>[0];

export const createFromTemplate = (template: TaskListItem, overrides: Partial<CreateTaskParams>) =>
  taskService.create({ instruction: template.instruction, title: template.title, ...overrides });

export const createMessageWriter = (deps: {
  createMessage: typeof messageService.createMessage;
  updateMessage: typeof messageService.updateMessage;
}) => ({
  create: deps.createMessage,
  update: deps.updateMessage,
});
