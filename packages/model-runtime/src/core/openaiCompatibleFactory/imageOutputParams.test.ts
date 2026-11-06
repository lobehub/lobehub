import { describe, expect, it } from 'vitest';

import {
  applyImageOutputParams,
  GIF_EDIT_UNSUPPORTED_MESSAGE,
  resolveImageOutputMimeType,
} from './imageOutputParams';

describe('applyImageOutputParams', () => {
  it('renames GIF output controls to Images API fields', () => {
    const input: Record<string, any> = {
      frameCount: 12,
      frameDurationMs: 120,
      outputFormat: 'gif',
      prompt: 'a cat',
    };

    applyImageOutputParams(input, { isImageEdit: false });

    expect(input).toEqual({
      frame_count: 12,
      frame_duration_ms: 120,
      output_format: 'gif',
      prompt: 'a cat',
    });
  });

  it('drops frame fields when the output is not a GIF', () => {
    const input: Record<string, any> = { frameCount: 9, frameDurationMs: 200, outputFormat: 'png' };

    applyImageOutputParams(input, { isImageEdit: true });

    expect(input).toEqual({ output_format: 'png' });
  });

  it('drops frame fields when no output format is requested', () => {
    const input: Record<string, any> = { frameCount: 9, prompt: 'p' };

    applyImageOutputParams(input, { isImageEdit: false });

    expect(input).toEqual({ prompt: 'p' });
  });

  it('rejects GIF output on the edit endpoint', () => {
    expect(() =>
      applyImageOutputParams({ outputFormat: 'gif' }, { isImageEdit: true }),
    ).toThrowError(GIF_EDIT_UNSUPPORTED_MESSAGE);
  });
});

describe('resolveImageOutputMimeType', () => {
  it('prefers the format reported by the response', () => {
    expect(resolveImageOutputMimeType('gif', 'png')).toBe('image/gif');
  });

  it('falls back to the requested format, then PNG', () => {
    expect(resolveImageOutputMimeType(undefined, 'webp')).toBe('image/webp');
    expect(resolveImageOutputMimeType(undefined, undefined)).toBe('image/png');
    expect(resolveImageOutputMimeType('unknown', null)).toBe('image/png');
  });
});
