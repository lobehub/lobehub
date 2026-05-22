import { describe, expect, it, vi } from 'vitest';

vi.mock('code-inspector-plugin', () => ({
  codeInspectorPlugin: vi.fn(() => ({})),
}));

describe('defineConfig', () => {
  it('should externalize epub2 so optional zipfile resolution stays at runtime', async () => {
    const { defineConfig } = await import('./define-config');

    const config = defineConfig({});

    expect(config.serverExternalPackages).toContain('epub2');
  });
});
