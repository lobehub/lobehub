import { expect, it } from 'vitest';

import { createTaskTree, deleteTask, readTaskRows } from './fixtures';

it('deletes the selected subtree while preserving its sibling', async () => {
  const { parent, child, sibling } = await createTaskTree();
  await deleteTask(parent.id);
  expect(await readTaskRows([parent.id, child.id])).toEqual([]);
  expect(await readTaskRows([sibling.id])).toEqual([sibling]);
});
