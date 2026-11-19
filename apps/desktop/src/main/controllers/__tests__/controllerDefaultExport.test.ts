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

describe('controller discovery', () => {
  // `App` loads controllers with this same flat glob; a controller turned into
  // a `FooCtr/index.ts` directory is silently never registered (its IPC calls
  // fail with "No handler registered"). Keep controllers as `*Ctr.ts` files and
  // put extracted helpers beside them.
  it('every registered controller is a module App.importAll discovers', () => {
    const discovered = new Set(Object.values(controllerModules).map((mod) => mod.default));
    for (const Ctor of controllerIpcConstructors) {
      expect(discovered.has(Ctor), Ctor.groupName).toBe(true);
    }
  });

  it('no service is a directory the *Srv.ts glob would skip', () => {
    const services = import.meta.glob('../../services/*Srv.ts');
    const nested = import.meta.glob('../../services/*Srv/index.ts');
    expect(Object.keys(services).length).toBeGreaterThan(0);
    expect(Object.keys(nested)).toEqual([]);
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
