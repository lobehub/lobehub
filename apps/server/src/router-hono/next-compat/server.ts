import { type AfterTask, getRequestContext, runAfterTask } from './context';

export const connection = async () => {};

export const after = (task: AfterTask): void => {
  const context = getRequestContext();
  if (context) {
    context.afterTasks.push(task);
    return;
  }

  void runAfterTask(task);
};
