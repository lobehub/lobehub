import { expect, it } from 'vitest';

import { projectCaller } from './fixtures';

it('rejects the supplied request', async () => {
  await expect(projectCaller.moveTask({ id: 'target', taskId: 'child' })).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
});
