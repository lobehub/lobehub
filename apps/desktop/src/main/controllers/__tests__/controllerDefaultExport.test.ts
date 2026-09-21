import { describe, expect, it } from 'vitest';

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
