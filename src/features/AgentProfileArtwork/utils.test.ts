import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { buildAgentArtworkPrompt, resolveAgentBackground, selectAgentArtworkModel } from './utils';

const createProvider = (id: string, modelIds: string[]): EnabledProviderWithModels => ({
  children: modelIds.map((modelId) => ({ abilities: {}, id: modelId })),
  id,
  name: id,
  source: 'builtin',
});

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
    expect(prompt).toContain('full-bleed composition');
    expect(prompt).toContain('no white background');
    expect(prompt).toContain('square profile icon');
    expect(prompt.toLowerCase()).toContain('no words');
  });

  it('builds a wide background prompt', () => {
    expect(buildAgentArtworkPrompt({ kind: 'background', title: 'Researcher' })).toContain(
      'wide cinematic profile cover',
    );
  });
});

describe('selectAgentArtworkModel', () => {
  it('prefers gpt-image-2 when another provider appears first', () => {
    const selection = selectAgentArtworkModel([
      createProvider('google', ['imagen-4']),
      createProvider('openai', ['gpt-image-2']),
    ]);

    expect(selection?.provider.id).toBe('openai');
    expect(selection?.model.id).toBe('gpt-image-2');
  });

  it('falls back to the first available image model', () => {
    expect(selectAgentArtworkModel([createProvider('fal', ['flux'])])?.model.id).toBe('flux');
  });
});
