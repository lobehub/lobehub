import { describe, expect, it } from 'vitest';

import { ModelProvider } from '../const/modelProvider';
import { AceDataCloudProvider } from './acedatacloud';
import { DEFAULT_MODEL_PROVIDER_LIST, getProviderDisplayName } from './index';

// This checks the actual lookup/order used by the built-in provider selector.
describe('Ace Data Cloud provider selection', () => {
  it('resolves a built-in card beside the aggregator group without enabling paid access', () => {
    const index = DEFAULT_MODEL_PROVIDER_LIST.findIndex(
      (card) => card.id === ModelProvider.AceDataCloud,
    );
    expect(index).toBeGreaterThan(0);
    expect(DEFAULT_MODEL_PROVIDER_LIST[index - 1].id).toBe(ModelProvider.OpenRouter);
    expect(getProviderDisplayName(ModelProvider.AceDataCloud)).toBe('Ace Data Cloud');
    expect(AceDataCloudProvider.enabled).not.toBe(true);
    expect(AceDataCloudProvider.checkModel).toBeUndefined();
    expect(AceDataCloudProvider.settings.showModelFetcher).toBe(true);
  });
});
