import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NEW_GLM_MODEL } from './starterModels';
import { useStarterModelDefaults } from './useStarterModelDefaults';

const mocks = vi.hoisted(() => ({
  enableBusinessFeatures: false,
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: (state: { enableBusinessFeatures: boolean }) =>
      state.enableBusinessFeatures,
  },
  useServerConfigStore: <T>(selector: (state: { enableBusinessFeatures: boolean }) => T) =>
    selector({ enableBusinessFeatures: mocks.enableBusinessFeatures }),
}));

beforeEach(() => {
  mocks.enableBusinessFeatures = false;
});

describe('useStarterModelDefaults', () => {
  it('uses the OSS fallback home new model entries in the current product order', () => {
    const { result } = renderHook(() => useStarterModelDefaults());

    expect(NEW_GLM_MODEL).toBe('glm-5.2');
    expect(result.current.fallbackChatProvider).toBe('zhipu');
    expect(result.current.defaultHomeNewModels).toEqual([
      {
        model: 'glm-5.2',
        provider: 'zhipu',
        title: 'GLM-5.2',
        type: 'chat',
      },
      {
        model: 'kimi-k2.7-code',
        provider: 'moonshot',
        title: 'Kimi K2.7 Code',
        type: 'chat',
      },
      {
        model: 'gpt-image-2',
        title: 'GPT Image 2',
        type: 'image',
      },
      {
        model: 'dreamina-seedance-2-0-260128',
        title: 'Seedance 2.0',
        type: 'video',
      },
    ]);
  });

  it('uses the business fallback home new model entries in the current product order', () => {
    mocks.enableBusinessFeatures = true;

    const { result } = renderHook(() => useStarterModelDefaults());

    expect(result.current.fallbackChatProvider).toBe('lobehub');
    expect(result.current.defaultHomeNewModels).toEqual([
      {
        model: 'glm-5.2',
        provider: 'lobehub',
        title: 'GLM-5.2',
        type: 'chat',
      },
      {
        model: 'kimi-k2.7-code',
        provider: 'lobehub',
        title: 'Kimi K2.7 Code',
        type: 'chat',
      },
      {
        model: 'gpt-image-2',
        title: 'GPT Image 2',
        type: 'image',
      },
      {
        model: 'dreamina-seedance-2-0-260128',
        title: 'Seedance 2.0',
        type: 'video',
      },
    ]);
  });
});
