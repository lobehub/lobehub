import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from '../aiModels';
import { ModelProvider } from '../const/modelProvider';
import { DEFAULT_MODEL_PROVIDER_LIST } from './index';
import { NaceProvider } from './nace';

describe('NaceProvider', () => {
  it('is registered as a configurable provider with the Drex decision models', () => {
    expect(DEFAULT_MODEL_PROVIDER_LIST).toContain(NaceProvider);
    expect(NaceProvider).toMatchObject({
      id: ModelProvider.Nace,
      name: 'Nace',
      settings: { showChecker: false, showModelFetcher: false },
    });

    for (const id of ['drex-max', 'drex-v2.0']) {
      expect(
        LOBE_DEFAULT_MODEL_LIST.find(
          (model) => model.providerId === ModelProvider.Nace && model.id === id,
        ),
      ).toMatchObject({ enabled: true, type: 'decision' });
    }
  });
});
