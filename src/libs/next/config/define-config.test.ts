import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineConfig } from './define-config';

describe('defineConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps Docker canvas tracing away from pnpm symlink directories', () => {
    vi.stubEnv('DOCKER', 'true');
    vi.stubEnv('NEXT_BUILD_STANDALONE', '');

    const includes = defineConfig({}).outputFileTracingIncludes?.['*'] ?? [];

    expect(includes).toContain('node_modules/@napi-rs/canvas/**/*');
    expect(includes).toContain('node_modules/@napi-rs/canvas-*/package.json');
    expect(includes).toContain('node_modules/@napi-rs/canvas-*/*.node');
    expect(includes).toContain(
      'node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/package.json',
    );
    expect(includes).toContain(
      'node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/*.node',
    );
    expect(includes).not.toContain('node_modules/@napi-rs/canvas-*/**/*');
    expect(includes).not.toContain('node_modules/.pnpm/@napi-rs+canvas*/**/*');
    expect(includes).not.toContain('node_modules/.pnpm/@napi-rs+canvas-*/**/*');
  });
});
