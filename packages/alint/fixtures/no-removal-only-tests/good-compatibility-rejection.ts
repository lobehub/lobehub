import { expect, it } from 'vitest';

import { createProjectFixture, projectCaller, readTaskRows } from './fixtures';

it('rejects moves through the retained API without changing a task tree', async () => {
  const { target, parent, child } = await createProjectFixture();
  const ids = [parent.id, child.id];
  const before = await readTaskRows(ids);
  await expect(projectCaller.moveTask({ id: target.id, taskId: parent.id })).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
    message: 'Moving tasks between projects is temporarily disabled',
  });
  expect(await readTaskRows(ids)).toEqual(before);
});
