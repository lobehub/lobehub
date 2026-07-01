import { describe, expect, it } from 'vitest';

import { dockerCanvasTracingIncludes } from './dockerCanvasTracingIncludes';

describe('dockerCanvasTracingIncludes', () => {
  it('keeps Docker canvas tracing away from pnpm symlink directories', () => {
    expect(dockerCanvasTracingIncludes).toContain('node_modules/@napi-rs/canvas/**/*');
    expect(dockerCanvasTracingIncludes).toContain('node_modules/@napi-rs/canvas-*/package.json');
    expect(dockerCanvasTracingIncludes).toContain('node_modules/@napi-rs/canvas-*/*.node');
    expect(dockerCanvasTracingIncludes).toContain(
      'node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/package.json',
    );
    expect(dockerCanvasTracingIncludes).toContain(
      'node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/*.node',
    );
    expect(dockerCanvasTracingIncludes).not.toContain('node_modules/@napi-rs/canvas-*/**/*');
    expect(dockerCanvasTracingIncludes).not.toContain('node_modules/.pnpm/@napi-rs+canvas*/**/*');
    expect(dockerCanvasTracingIncludes).not.toContain('node_modules/.pnpm/@napi-rs+canvas-*/**/*');
  });
});
