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
  describe('enableDashboard', () => {
    it('is off by default and on only when the flag resolves to true', () => {
      expect(serverConfigSelectors.enableDashboard(initServerConfigStore({}).getState())).toBe(
        false,
      );
      const on = initServerConfigStore({
        featureFlags: {
          ...mapFeatureFlagsEnvToState({ ...DEFAULT_FEATURE_FLAGS, dashboard: true }),
        },
      });
      expect(serverConfigSelectors.enableDashboard(on.getState())).toBe(true);
    });
  });

  describe('enableGatewayMode', () => {
    it('should return true when gateway mode is enabled', () => {
      const store = initServerConfigStore({
        serverConfig: {
          aiProvider: {},
          enableGatewayMode: true,
          telemetry: {},
        },
      });

      const result = serverConfigSelectors.enableGatewayMode(store.getState());

      expect(result).toBe(true);
    });

    it('should return false when gateway mode is not defined', () => {
      const store = initServerConfigStore({
        serverConfig: {
          aiProvider: {},
          telemetry: {},
        },
      });

      const result = serverConfigSelectors.enableGatewayMode(store.getState());

      expect(result).toBe(false);
    });
  });

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

  describe('widgetSandboxEnforcesNetworkHosts', () => {
    it('is true only when the sandbox runs in allowlist mode', () => {
      const enforced = initServerConfigStore({
        serverConfig: { aiProvider: {}, telemetry: {}, widgetSandboxNetworkFormat: 'allowlist' },
      });
      expect(serverConfigSelectors.widgetSandboxEnforcesNetworkHosts(enforced.getState())).toBe(
        true,
      );

      // The deployed Worker's boolean format — and an unset format, which
      // defaults to it — cannot limit egress to the declared hosts.
      const booleanFormat = initServerConfigStore({
        serverConfig: { aiProvider: {}, telemetry: {}, widgetSandboxNetworkFormat: 'boolean' },
      });
      expect(
        serverConfigSelectors.widgetSandboxEnforcesNetworkHosts(booleanFormat.getState()),
      ).toBe(false);
      const unset = initServerConfigStore({
        serverConfig: { aiProvider: {}, telemetry: {} },
      });
      expect(serverConfigSelectors.widgetSandboxEnforcesNetworkHosts(unset.getState())).toBe(false);
    });
  });
});
