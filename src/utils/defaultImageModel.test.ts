import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROVIDER,
  resolveImageModelSelection,
} from './defaultImageModel';

const provider = (id: string, ...models: string[]) => ({
  children: models.map((model) => ({ id: model })),
  id,
});

describe('resolveImageModelSelection', () => {
  it('prefers the default model on the default provider', () => {
    expect(
      resolveImageModelSelection([
        provider('lobehub', DEFAULT_AI_IMAGE_MODEL),
        provider(DEFAULT_AI_IMAGE_PROVIDER, 'imagen-4', DEFAULT_AI_IMAGE_MODEL),
      ]),
    ).toEqual({ model: DEFAULT_AI_IMAGE_MODEL, provider: DEFAULT_AI_IMAGE_PROVIDER });
  });

  it('falls back to another provider serving the default model', () => {
    expect(
      resolveImageModelSelection([
        provider('openai', 'gpt-image-2'),
        provider('lobehub', 'gpt-image-2', DEFAULT_AI_IMAGE_MODEL),
      ]),
    ).toEqual({ model: DEFAULT_AI_IMAGE_MODEL, provider: 'lobehub' });
  });

  it('falls back to the first enabled model when no provider serves the default model', () => {
    expect(
      resolveImageModelSelection([provider('empty'), provider('fal', 'flux-dev', 'flux-pro')]),
    ).toEqual({ model: 'flux-dev', provider: 'fal' });
  });

  it('returns undefined when no image model is enabled', () => {
    expect(resolveImageModelSelection([])).toBeUndefined();
    expect(resolveImageModelSelection([provider('empty')])).toBeUndefined();
  });

  it('finds the first provider serving an explicit model', () => {
    const providers = [provider('openai', 'gpt-image-2'), provider('lobehub', 'gpt-image-2')];

    expect(resolveImageModelSelection(providers, { model: 'gpt-image-2' })).toEqual({
      model: 'gpt-image-2',
      provider: 'openai',
    });
    expect(resolveImageModelSelection(providers, { model: 'missing' })).toBeUndefined();
  });

  it('applies the default rule within an explicit provider', () => {
    const providers = [provider('lobehub', DEFAULT_AI_IMAGE_MODEL), provider('fal', 'flux-dev')];

    expect(resolveImageModelSelection(providers, { provider: 'fal' })).toEqual({
      model: 'flux-dev',
      provider: 'fal',
    });
    expect(resolveImageModelSelection(providers, { provider: 'lobehub' })).toEqual({
      model: DEFAULT_AI_IMAGE_MODEL,
      provider: 'lobehub',
    });
    expect(resolveImageModelSelection(providers, { provider: 'openai' })).toBeUndefined();
  });
});
