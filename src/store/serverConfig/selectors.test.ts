import { describe, expect, it } from 'vitest';

import { DEFAULT_FEATURE_FLAGS, mapFeatureFlagsEnvToState } from '@/config/featureFlags';

import { featureFlagsSelectors, serverConfigSelectors } from './selectors';
import { initServerConfigStore } from './store';

describe('featureFlagsSelectors', () => {
  it('should return feature flags from store', () => {
    const store = initServerConfigStore({
      featureFlags: {
        ...mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
        isAgentEditable: false,
        showProvider: true,
        showMarket: true,
        showAiImage: true,
      },
    });

    const result = featureFlagsSelectors(store.getState());

    expect(result.isAgentEditable).toBe(false);
    expect(result.showProvider).toBe(true);
    expect(result.showMarket).toBe(true);
    expect(result.showAiImage).toBe(true);
  });
});

describe('serverConfigSelectors', () => {
  describe('enabledTelemetryChat', () => {
    it('should return langfuse value from store when defined', () => {
      const store = initServerConfigStore({
        serverConfig: {
          telemetry: { langfuse: true },
          aiProvider: {},
        },
      });

      const result = serverConfigSelectors.enabledTelemetryChat(store.getState());

      expect(result).toBe(true);
    });

    it('should return false when langfuse is not defined', () => {
      const store = initServerConfigStore({
        serverConfig: {
          telemetry: {},
          aiProvider: {},
        },
      });

      const result = serverConfigSelectors.enabledTelemetryChat(store.getState());

      expect(result).toBe(false);
    });
  });
});
