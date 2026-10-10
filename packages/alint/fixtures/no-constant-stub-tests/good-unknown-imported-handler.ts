import { expect, it } from 'vitest';

import { projectCaller } from './fixtures';

// The endpoint implementation is not available in this file: do not guess that it is inert.
it('rejects the supplied request', async () => {
  await expect(projectCaller.moveTask({ id: 'target', taskId: 'child' })).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
});
