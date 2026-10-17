import { describe, expect, it } from 'vitest';

import {
  getInteractiveUIPreview,
  INTERACTIVE_UI_LIMITS,
  LegacyRenderUIParamsSchema,
} from './schema';

export const validArtifact = {
  css: '',
  fallback: 'A small calculator',
  html: '<p id="result">0</p>',
  js: '',
  title: 'Calculator',
  version: 1,
};

describe('interactive UI schema', () => {
  it('accepts a complete artifact and rejects unknown permissions and versions', () => {
    expect(LegacyRenderUIParamsSchema.safeParse(validArtifact).success).toBe(true);
    expect(LegacyRenderUIParamsSchema.safeParse({ ...validArtifact, network: true }).success).toBe(
      false,
    );
    expect(LegacyRenderUIParamsSchema.safeParse({ ...validArtifact, version: 2 }).success).toBe(
      false,
    );
    expect(LegacyRenderUIParamsSchema.safeParse({ ...validArtifact, js: undefined }).success).toBe(
      false,
    );
  });

  it('bounds individual fields and UTF-8 total source bytes', () => {
    expect(
      LegacyRenderUIParamsSchema.safeParse({ ...validArtifact, title: 'x'.repeat(121) }).success,
    ).toBe(false);
    expect(
      LegacyRenderUIParamsSchema.safeParse({
        ...validArtifact,
        js: 'x'.repeat(INTERACTIVE_UI_LIMITS.js + 1),
      }).success,
    ).toBe(false);
    expect(
      LegacyRenderUIParamsSchema.safeParse({ ...validArtifact, html: '你'.repeat(45_000) }).success,
    ).toBe(false);
  });

  it('never includes JavaScript in partial previews and bounds malformed input', () => {
    expect(getInteractiveUIPreview({ html: '<div', css: 'p{', js: 'doSomething()' })).toEqual({
      css: 'p{',
      html: '<div',
      js: '',
    });
    expect(getInteractiveUIPreview(null)).toEqual({ css: '', html: '', js: '' });
    expect(getInteractiveUIPreview({ html: {}, css: ['x'] })).toEqual({
      css: '',
      html: '',
      js: '',
    });
    expect(getInteractiveUIPreview({ html: 'x'.repeat(100_000) }).html).toHaveLength(
      INTERACTIVE_UI_LIMITS.html,
    );
  });
});
