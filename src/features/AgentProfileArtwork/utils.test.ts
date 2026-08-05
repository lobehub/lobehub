import { describe, expect, it } from 'vitest';

import { buildAgentArtworkPrompt, resolveAgentBackground } from './utils';

describe('resolveAgentBackground', () => {
  it.each(['#fff', 'rgb(0, 0, 0)', 'transparent', 'red', 'rgba(0,0,0,0)'])(
    'ignores the legacy color value %s',
    (value) => {
      expect(resolveAgentBackground(value)).toBeUndefined();
    },
  );

  it.each([
    'https://example.com/cover.webp',
    'http://example.com/cover.png',
    '/f/file-id',
    'data:image/png;base64,abc',
  ])('keeps the image source %s', (value) => {
    expect(resolveAgentBackground(value)).toBe(value);
  });
});

describe('buildAgentArtworkPrompt', () => {
  it('builds an avatar-specific prompt from the agent identity', () => {
    const prompt = buildAgentArtworkPrompt({
      kind: 'avatar',
      name: 'Coco',
      title: 'Coding assistant',
    });

    expect(prompt).toContain('Coco. Coding assistant');
    expect(prompt).toContain('square profile icon');
    expect(prompt).toContain('no words');
  });

  it('builds a wide background prompt', () => {
    expect(buildAgentArtworkPrompt({ kind: 'background', title: 'Researcher' })).toContain(
      'wide cinematic profile cover',
    );
  });
});
