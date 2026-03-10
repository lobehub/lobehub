import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FEATURE_FLAGS, mapFeatureFlagsEnvToState } from '@/config/featureFlags';

import { type ServerConfigStore } from './store';
import { createServerConfigStore, initServerConfigStore } from './store';

describe('createServerConfigStore', () => {
  beforeEach(() => {
    // 每个测试用例前重置模块状态
    vi.resetModules();
  });

  it('should create a singleton store', () => {
    const store1 = createServerConfigStore();
    const store2 = createServerConfigStore();

    expect(store1).toBe(store2);
  });

  it('should initialize store with default state', () => {
    const store = createServerConfigStore();

    expect(store.getState().featureFlags).toHaveProperty('showMarket');
    expect(store.getState()).toMatchObject({
      serverConfig: { telemetry: {}, aiProvider: {} },
    });
  });

  it('should initialize store with custom initial state', () => {
    const initialState: Partial<ServerConfigStore> = {
      featureFlags: {
        ...mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
        isAgentEditable: false,
      },
      serverConfig: { telemetry: { langfuse: true }, aiProvider: {} },
    };

    const store = initServerConfigStore(initialState);

    expect(store.getState().featureFlags.isAgentEditable).toBeFalsy();
    expect(store.getState().serverConfig).toEqual({
      telemetry: { langfuse: true },
      aiProvider: {},
    });
  });

  it('should update store state correctly', () => {
    const store = createServerConfigStore();

    act(() => {
      store.setState({
        featureFlags: {
          ...store.getState().featureFlags,
          showMarket: false,
        },
      });
    });

    expect(store.getState().featureFlags.showMarket).toBeFalsy();
  });
});
