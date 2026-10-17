import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

it('keeps Node capabilities out of browser-reachable source', async () => {
  const source = await readFile(new URL('./browser.ts', import.meta.url), 'utf8');
  // This is an ongoing browser isolation policy, not confirmation of a removed helper.
  expect(source).not.toMatch(/from ['"]node:/);
});
