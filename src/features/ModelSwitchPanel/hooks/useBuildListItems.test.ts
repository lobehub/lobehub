import type { AiModelForSelect } from 'model-bank';
import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { buildListItems } from './useBuildListItems';

const model = (id: string, displayName = id, releasedAt?: string) =>
  ({ abilities: {}, displayName, id, releasedAt }) satisfies AiModelForSelect;

/** `isNewReleaseDate` uses a 14-day window, so anchor fixtures relative to today. */
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const provider = (id: string, children: AiModelForSelect[]): EnabledProviderWithModels => ({
  children,
  id,
  name: id,
  source: 'builtin',
});

const getProviderModelIds = (items: ReturnType<typeof buildListItems>) =>
  items.flatMap((item) => (item.type === 'provider-model-item' ? [item.model.id] : []));

describe('buildListItems', () => {
  it('should stably move matching models after other models within a provider', () => {
    const items = buildListItems(
      [provider('lobehub', [model('pro-a'), model('normal-a'), model('pro-b'), model('normal-b')])],
      'byProvider',
      '',
      (modelId, providerId) => providerId === 'lobehub' && modelId.startsWith('pro-'),
    );

    expect(getProviderModelIds(items)).toEqual(['normal-a', 'normal-b', 'pro-a', 'pro-b']);
  });

  it('should not move a by-model row when another provider remains available', () => {
    const items = buildListItems(
      [
        provider('lobehub', [model('mixed-pro', 'Mixed'), model('lobehub-pro'), model('normal')]),
        provider('openai', [model('mixed-pro', 'Mixed')]),
      ],
      'byModel',
      '',
      (modelId, providerId) => providerId === 'lobehub' && modelId.includes('pro'),
    );

    expect(
      items.flatMap((item) =>
        item.type === 'model-item-single' || item.type === 'model-item-multiple'
          ? [item.data.model.id]
          : [],
      ),
    ).toEqual(['mixed-pro', 'normal', 'lobehub-pro']);
  });

  it('should order the pinned new models newest-first instead of by catalog order', () => {
    const items = buildListItems(
      [
        provider('lobehub', [
          model('fable-5.1', 'Claude Fable 5.1', daysAgo(3)),
          model('gpt-6-astra', 'GPT-6 Astra', daysAgo(1)),
          model('glm-5.3-flash', 'GLM-5.3-Flash', daysAgo(9)),
          model('deepseek-v4-pro', 'DeepSeek V4 Pro', daysAgo(200)),
        ]),
      ],
      'byProvider',
    );

    expect(getProviderModelIds(items)).toEqual([
      'gpt-6-astra',
      'fable-5.1',
      'glm-5.3-flash',
      'deepseek-v4-pro',
    ]);
  });

  it('should keep catalog order for new models released on the same day', () => {
    const sameDay = daysAgo(2);
    const items = buildListItems(
      [
        provider('lobehub', [
          model('gemini-3.8-flash', 'Gemini 3.8 Flash', sameDay),
          model('qwen3.8-max', 'Qwen3.8 Max', sameDay),
          model('legacy', 'Legacy', daysAgo(400)),
        ]),
      ],
      'byProvider',
    );

    expect(getProviderModelIds(items)).toEqual(['gemini-3.8-flash', 'qwen3.8-max', 'legacy']);
  });

  it('should order new models newest-first in byModel mode too', () => {
    const items = buildListItems(
      [
        provider('lobehub', [
          model('fable-5.1', 'Claude Fable 5.1', daysAgo(3)),
          model('gpt-6-astra', 'GPT-6 Astra', daysAgo(1)),
        ]),
      ],
      'byModel',
    );

    expect(
      items.flatMap((item) =>
        item.type === 'model-item-single' || item.type === 'model-item-multiple'
          ? [item.data.model.id]
          : [],
      ),
    ).toEqual(['gpt-6-astra', 'fable-5.1']);
  });
});
