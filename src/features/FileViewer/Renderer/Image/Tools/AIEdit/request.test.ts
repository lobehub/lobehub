import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { AI_EDIT_PROMPTS, buildAIEditRequest, resolveAIEditModel } from './request';

const card = (id: string, parameters?: Record<string, unknown>) =>
  ({ abilities: {}, id, parameters }) as EnabledProviderWithModels['children'][number];

const providers = (list: [string, ReturnType<typeof card>[]][]): EnabledProviderWithModels[] =>
  list.map(([id, children]) => ({ children, id, name: id, source: 'builtin' }) as any);

describe('resolveAIEditModel', () => {
  const enabled = providers([
    [
      'lobehub',
      [
        card('text-only', { prompt: { default: '' } }),
        card('gemini-3.1-flash-image:image', { imageUrls: { default: [] }, prompt: {} }),
      ],
    ],
    ['fal', [card('flux-kontext', { imageUrl: { default: null }, prompt: {} })]],
  ]);

  it('prefers the last selected model when it accepts a reference image', () => {
    expect(resolveAIEditModel(enabled, { model: 'flux-kontext', provider: 'fal' })).toEqual({
      model: 'flux-kontext',
      provider: 'fal',
      referenceParam: 'imageUrl',
    });
  });

  it('skips a last selected model that cannot take a reference image', () => {
    expect(resolveAIEditModel(enabled, { model: 'text-only', provider: 'lobehub' })).toEqual({
      model: 'gemini-3.1-flash-image:image',
      provider: 'lobehub',
      referenceParam: 'imageUrls',
    });
  });

  it('falls back to any editable model', () => {
    expect(
      resolveAIEditModel(providers([['fal', [card('flux-kontext', { imageUrl: {} })]]])),
    ).toMatchObject({ model: 'flux-kontext', provider: 'fal' });
  });

  it('returns undefined when no enabled model can edit', () => {
    expect(resolveAIEditModel(providers([['x', [card('t2i', { prompt: {} })]]]))).toBeUndefined();
    expect(resolveAIEditModel([])).toBeUndefined();
  });
});

describe('buildAIEditRequest', () => {
  it('sends the image as `imageUrls` with the operation prompt', () => {
    expect(
      buildAIEditRequest({
        generationTopicId: 'gt_1',
        imageUrl: 'https://app.lobehub.com/f/file_src',
        model: {
          model: 'gemini-3.1-flash-image:image',
          provider: 'lobehub',
          referenceParam: 'imageUrls',
        },
        operation: 'removeBackground',
      }),
    ).toEqual({
      generationTopicId: 'gt_1',
      imageNum: 1,
      model: 'gemini-3.1-flash-image:image',
      params: {
        imageUrls: ['https://app.lobehub.com/f/file_src'],
        prompt: AI_EDIT_PROMPTS.removeBackground,
      },
      provider: 'lobehub',
    });
  });

  it('uses `imageUrl` for single-reference models', () => {
    const request = buildAIEditRequest({
      generationTopicId: 'gt_1',
      imageUrl: 'https://guide.png',
      model: { model: 'flux-kontext', provider: 'fal', referenceParam: 'imageUrl' },
      operation: 'erase',
    });
    expect(request.params).toEqual({
      imageUrl: 'https://guide.png',
      prompt: AI_EDIT_PROMPTS.erase,
    });
  });

  it('describes the erase mark color in the erase prompt', () => {
    expect(AI_EDIT_PROMPTS.erase).toContain('#FF00FF');
  });
});
