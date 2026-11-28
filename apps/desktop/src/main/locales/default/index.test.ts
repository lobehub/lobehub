import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('default locale barrel', () => {
  it('can be imported as a directory module, as scripts/i18nWorkflow does', async () => {
    const { default: resources } = await import('@/locales/default');

    expect(Object.keys(resources).sort()).toEqual(['common', 'dialog', 'menu']);
  });

  it('exports every namespace file in the directory', async () => {
    const { default: resources } = await import('@/locales/default');
    const namespaces = readdirSync(__dirname)
      .filter((file) => file.endsWith('.ts') && file !== 'index.ts' && !file.endsWith('.test.ts'))
      .map((file) => file.replace(/\.ts$/, ''));

    expect(Object.keys(resources).sort()).toEqual(namespaces.sort());
  });
});
