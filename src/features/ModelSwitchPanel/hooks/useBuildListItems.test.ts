import type { AiModelForSelect } from 'model-bank';
import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { buildListItems } from './useBuildListItems';

const model = (id: string, displayName = id) =>
  ({ abilities: {}, displayName, id }) satisfies AiModelForSelect;

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
});
