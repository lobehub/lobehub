import type { EnabledAiModel, EnabledProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { decisionModelProviders } from './decisionModelProviders';

const model = (id: string, patch: Partial<EnabledAiModel> = {}): EnabledAiModel => ({
  abilities: {},
  id,
  providerId: 'typesafe',
  type: 'decision',
  ...patch,
});
const providers: EnabledProvider[] = [{ id: 'typesafe', name: 'TypeSafe', source: 'builtin' }];

describe('decisionModelProviders', () => {
  it('only offers enabled, visible decision models from enabled providers', () => {
    const result = decisionModelProviders(
      [
        model('jev'),
        model('chat', { type: 'chat' }),
        model('disabled', { enabled: false }),
        model('hidden', { visible: false }),
        model('other-provider', { providerId: 'other' }),
      ],
      providers,
      {},
    );
    expect(result.map(({ children }) => children.map(({ id }) => id))).toEqual([['jev']]);
  });

  it.each([undefined, false])(
    'excludes keyless custom endpoints with fetchOnClient=%s',
    (fetchOnClient) => {
      expect(
        decisionModelProviders([model('jev')], providers, {
          typesafe: {
            config: {},
            settings: {},
            keyVaults: { baseURL: 'http://localhost:8080/v1' },
            fetchOnClient,
          },
        }),
      ).toEqual([]);
    },
  );

  it('keeps server-configured providers when a stale client flag has no client credentials', () => {
    expect(
      decisionModelProviders([model('jev')], providers, {
        typesafe: { config: {}, settings: {}, keyVaults: {}, fetchOnClient: true },
      }),
    ).toHaveLength(1);
  });

  it('excludes client-only providers and empty groups', () => {
    expect(decisionModelProviders([], providers, {})).toEqual([]);
    expect(
      decisionModelProviders([model('jev')], providers, {
        typesafe: {
          config: {},
          settings: {},
          keyVaults: { apiKey: 'test-key' },
          fetchOnClient: true,
        },
      }),
    ).toEqual([]);
  });
});
