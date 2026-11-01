import { expect, it, vi } from 'vitest';

import { createTaskService } from './service';

it('denies unauthorized task deletion before a database write', async () => {
  const database = { deleteTask: vi.fn() };
  const service = createTaskService(database);
  await expect(service.deleteTask({ role: 'viewer', taskId: 'task-1' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(database.deleteTask).not.toHaveBeenCalled();
});
