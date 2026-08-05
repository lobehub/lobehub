import { describe, expect, it, vi } from 'vitest';

import { selectAgentArtworkModel } from '@/store/agent/slices/artwork/utils';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { openFilePicker, resolveAgentBackground } from './utils';

describe('openFilePicker', () => {
  it('uses the native picker while preserving click as a compatibility fallback', () => {
    const input = document.createElement('input');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const showPicker = vi.fn();
    input.showPicker = showPicker;

    openFilePicker(input);

    expect(showPicker).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();

    showPicker.mockImplementation(() => {
      throw new Error('showPicker is unavailable');
    });
    openFilePicker(input);

    expect(click).toHaveBeenCalledOnce();
  });
});

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
