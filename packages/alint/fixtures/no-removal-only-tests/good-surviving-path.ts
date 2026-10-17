import { expect, it } from 'vitest';

import { createProjectTask } from './commands';

it('still creates project tasks after removing the move command', async () => {
  const created = await createProjectTask({ projectId: 'project-1', instruction: 'Launch' });
  expect(created.projectId).toBe('project-1');
  expect(created.identifier).toBeTruthy();
});
