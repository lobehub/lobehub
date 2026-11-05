import { TaskBulkActionsPanel } from 'verification:component';

const noop = () => {};

const tasks = [
  { archivedAt: null, id: 'task-a', identifier: 'T-1' },
  { archivedAt: null, id: 'task-b', identifier: 'T-2' },
];

export const Fixture = () => <TaskBulkActionsPanel tasks={tasks} onClose={noop} />;
