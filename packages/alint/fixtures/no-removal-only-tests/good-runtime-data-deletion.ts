import { expect, it } from 'vitest';

import { createProject, findProject, projectCaller } from './fixtures';

it('deletes a project record while preserving another project', async () => {
  const removed = await createProject('Removed');
  const retained = await createProject('Retained');
  await projectCaller.delete({ id: removed.id });
  expect(await findProject(removed.id)).toBeNull();
  expect(await findProject(retained.id)).toEqual(retained);
});
