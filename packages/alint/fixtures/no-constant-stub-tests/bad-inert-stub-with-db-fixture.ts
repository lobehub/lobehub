import { expect, it } from 'vitest';

import { createProjectTree, projectCaller, readTaskRows } from './fixtures';

// The shipped project.moveTask handler is an unconditional compatibility stub:
// it only throws PRECONDITION_FAILED with the disabled message, without reading or writing tasks.
// alint-expect
it('rejects moves without changing the parent and child rows', async () => {
  const { target, parent, child } = await createProjectTree();
  const ids = [parent.id, child.id];
  const before = await readTaskRows(ids);
  for (const taskId of ids) {
    await expect(projectCaller.moveTask({ id: target.id, taskId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Moving tasks between projects is temporarily disabled',
    });
    expect(await readTaskRows(ids)).toEqual(before);
  }
});
