import type { AiModelForSelect } from 'model-bank';
import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import {
  buildListItems,
  MAX_PINNED_NEW_MODELS,
  resolveListGuardOptions,
} from './useBuildListItems';

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
  it('should pin only the newest new models and keep the rest in catalog order', () => {
    expect(MAX_PINNED_NEW_MODELS).toBe(4);

    const items = buildListItems(
      [
        provider('lobehub', [
          model('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', daysAgo(200)),
          model('claude-sonnet-5.5', 'Claude Sonnet 5.5', daysAgo(6)),
          model('claude-sonnet-5', 'Claude Sonnet 5', daysAgo(100)),
          model('claude-haiku-5.5', 'Claude Haiku 5.5', daysAgo(2)),
          model('gpt-6.1-sol', 'GPT-6.1 Sol', daysAgo(5)),
          model('gpt-6-sol', 'GPT-6 Sol', daysAgo(10)),
          model('grok-4.7', 'Grok 4.7', daysAgo(1)),
          model('glm-5.3', 'GLM-5.3', daysAgo(3)),
        ]),
      ],
      'byProvider',
    );

    expect(getProviderModelIds(items)).toEqual([
      'grok-4.7',
      'claude-haiku-5.5',
      'glm-5.3',
      'gpt-6.1-sol',
      'deepseek-v4.1-flash',
      'claude-sonnet-5.5',
      'claude-sonnet-5',
      'gpt-6-sol',
    ]);
  });

  it('should not spend pinned slots on models sorted last', () => {
    const items = buildListItems(
      [
        provider('lobehub', [
          model('legacy', 'Legacy', daysAgo(400)),
          model('pro-a', 'Pro A', daysAgo(1)),
          model('pro-b', 'Pro B', daysAgo(1)),
          model('pro-c', 'Pro C', daysAgo(1)),
          model('pro-d', 'Pro D', daysAgo(1)),
          model('new-free', 'New Free', daysAgo(5)),
        ]),
      ],
      'byProvider',
      '',
      (modelId) => modelId.startsWith('pro-'),
    );

    expect(getProviderModelIds(items)).toEqual([
      'new-free',
      'legacy',
      'pro-a',
      'pro-b',
      'pro-c',
      'pro-d',
    ]);
  });
  it('should group pinned new models by vendor series, keeping catalog order inside a series', () => {
    const items = buildListItems(
      [
        provider('lobehub', [
          model('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', daysAgo(200)),
          model('claude-sonnet-5.5', 'Claude Sonnet 5.5', daysAgo(4)),
          model('claude-haiku-5.5', 'Claude Haiku 5.5', daysAgo(1)),
          model('gpt-6.1-sol', 'GPT-6.1 Sol', daysAgo(2)),
          model('grok-4.7', 'Grok 4.7', daysAgo(3)),
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
    ).toEqual([
      'claude-sonnet-5.5',
      'claude-haiku-5.5',
      'gpt-6.1-sol',
      'grok-4.7',
      'deepseek-v4.1-flash',
    ]);
  });
});

describe('buildListItems featured and hidden models', () => {
  const featuredModels = [
    {
      badge: 'Own quota',
      modelId: 'auto',
      providerId: 'lobehub',
    },
  ];

  it('lists a featured model first, out of its provider list', () => {
    const items = buildListItems(
      [provider('lobehub', [model('gpt'), model('auto')]), provider('openai', [model('gpt')])],
      'byProvider',
      '',
      undefined,
      { featuredModels },
    );

    expect(items[0]).toMatchObject({
      badge: 'Own quota',
      model: { id: 'auto' },
      type: 'featured-model-item',
    });
    expect(getProviderModelIds(items)).toEqual(['gpt', 'gpt']);
  });

  it('drops the header of a provider whose only model is featured', () => {
    const items = buildListItems(
      [provider('lobehub', [model('auto')]), provider('openai', [model('gpt')])],
      'byProvider',
      '',
      undefined,
      { featuredModels },
    );

    expect(items.map((item) => item.type)).toEqual([
      'featured-model-item',
      'group-header',
      'provider-model-item',
    ]);
    expect(items[1]).toMatchObject({ provider: { id: 'openai' } });
  });

  it('skips a featured model that is not enabled', () => {
    const items = buildListItems([provider('lobehub', [model('gpt')])], 'byModel', '', undefined, {
      featuredModels,
    });

    expect(items.some((item) => item.type === 'featured-model-item')).toBe(false);
  });
});

describe('resolveListGuardOptions', () => {
  const guard = { featuredModels: [{ modelId: 'auto', providerId: 'lobehub' }] };

  it('applies the guard to chat lists, including a list the host narrowed', () => {
    expect(resolveListGuardOptions(false, guard)).toEqual(guard);
  });

  it('keeps generation lists as given', () => {
    expect(resolveListGuardOptions(true, guard)).toBeUndefined();
  });
});
