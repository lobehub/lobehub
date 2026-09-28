import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ usageReader: false }));

// The reader imports `node:fs`. Recording when its module is evaluated tells us
// whether loading the adapter drags it in.
vi.mock('../utils/kimiCodeUsage', () => {
  loaded.usageReader = true;
  return { readKimiCodeSessionUsage: vi.fn().mockResolvedValue(undefined) };
});

/**
 * Regression: adapters are bundled for the browser too, and the adapter imported
 * the Node-only session-log reader at module scope. In the Vite dev SPA the
 * externalized `node:fs/promises` stub throws on first access, so the whole app
 * rendered blank. The reader must load only when post-run usage is collected,
 * which happens in the Node process that spawned the CLI.
 */
describe('KimiCodeAdapter module graph', () => {
  it('does not load the Node-only usage reader until usage is collected', async () => {
    const { KimiCodeAdapter } = await import('./kimiCode');
    const adapter = new KimiCodeAdapter();

    expect(loaded.usageReader).toBe(false);

    await adapter.collectPostRunUsage();

    expect(loaded.usageReader).toBe(true);
  });
});
