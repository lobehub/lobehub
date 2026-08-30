import { describe, expect, it } from 'vitest';

import { createBuiltinDevDockItems } from './registerBuiltinItems';

const panelIdsForRuntime = (desktopRuntime: boolean) =>
  createBuiltinDevDockItems(desktopRuntime)
    .filter((item) => item.type === 'panel')
    .map((item) => item.id);

describe('built-in DevDock panels', () => {
  it('exposes the physical local database inspector only in Electron', () => {
    expect(panelIdsForRuntime(false)).not.toContain('local-database');
    expect(panelIdsForRuntime(true)).toContain('local-database');
  });

  it('keeps the runtime-neutral projection inspector available in both runtimes', () => {
    expect(panelIdsForRuntime(false)).toContain('projection');
    expect(panelIdsForRuntime(true)).toContain('projection');
  });
});
