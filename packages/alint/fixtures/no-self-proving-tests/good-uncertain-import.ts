import { expect, it } from 'vitest';

declare const readPreferences: () => Promise<{ mode: string }>;

it('reads the stored preference through its owner', async () => {
  expect(await readPreferences()).toEqual({ mode: 'quiet' });
});
