import { readFile } from 'node:fs/promises';

import { assertApprovedPath } from './approvedRoots';

export const readWorkspaceFile = async (input: { path: string }) => {
  await assertApprovedPath(input.path);
  return readFile(input.path);
};
