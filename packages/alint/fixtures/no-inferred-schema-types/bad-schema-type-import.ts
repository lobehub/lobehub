// Fixture: a router imports row types that the schema module infers and re-exports.
// alint-expect
import type { NewTask, TaskItem } from '@/database/schemas';

export const toListItem = (task: TaskItem) => ({ id: task.id, title: task.name });

export const draftTask = (name: string): NewTask => ({ name }) as NewTask;
