import { describe, expect, it } from 'vitest';

import HeteroSessionCtr from '../HeteroSessionCtr';
import McpInstallCtr from '../McpInstallCtr';
import { controllerIpcConstructors } from '../registry';

const controllerModules = import.meta.glob('../*Ctr.ts', { eager: true }) as Record<
  string,
  { default?: unknown }
>;

describe('controller default exports', () => {
  it('every *Ctr.ts module has a constructor default export for App.importAll', () => {
    const entries = Object.entries(controllerModules);
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, mod] of entries) {
      expect(typeof mod.default, file).toBe('function');
    }
  });
});

describe('controllerIpcConstructors', () => {
  it('registers HeteroSessionCtr with unique non-empty group names', () => {
    expect(controllerIpcConstructors).toContain(HeteroSessionCtr);
    expect(HeteroSessionCtr.groupName).toBe('heteroSession');
    expect(McpInstallCtr.groupName).toBe('mcpInstall');

    const names = controllerIpcConstructors.map((Ctor) => Ctor.groupName);
    expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
