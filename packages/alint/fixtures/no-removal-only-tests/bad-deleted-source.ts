import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

// moveTaskTree was deleted from the model, with no replacement implementation.
// alint-expect
it('confirms the old moveTaskTree implementation has been deleted', async () => {
  const source = await readFile(new URL('./project.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('async moveTaskTree(');
});
