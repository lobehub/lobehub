import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from '../aiModels';
import { ModelProvider } from '../const/modelProvider';
import { DEFAULT_MODEL_PROVIDER_LIST } from './index';
import { TypeSafeProvider } from './typesafe';

describe('TypeSafeProvider', () => {
  it('is registered as a configurable provider with Jev 1.14', () => {
    expect(DEFAULT_MODEL_PROVIDER_LIST).toContain(TypeSafeProvider);
    expect(TypeSafeProvider).toMatchObject({
      id: ModelProvider.TypeSafe,
      name: 'TypeSafe',
      settings: { showChecker: false, showModelFetcher: false },
    });
    expect(
      LOBE_DEFAULT_MODEL_LIST.find(
        (model) => model.providerId === ModelProvider.TypeSafe && model.id === 'jev-1.14.0',
      ),
    ).toMatchObject({ enabled: true, type: 'decision' });
  });
});
