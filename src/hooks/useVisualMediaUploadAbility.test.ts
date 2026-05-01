import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useModelSupportVideo } from '@/hooks/useModelSupportVideo';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useAiInfraStore } from '@/store/aiInfra';
import { useServerConfigStore } from '@/store/serverConfig';

import { useVisualMediaUploadAbility } from './useVisualMediaUploadAbility';

vi.mock('@/hooks/useModelSupportToolUse');
vi.mock('@/hooks/useModelSupportVideo');
vi.mock('@/hooks/useModelSupportVision');
vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    getEnabledModelById:
      (id: string, provider: string) =>
      (s: {
        enabledAiModels?: {
          abilities: { video?: boolean; vision?: boolean };
          id: string;
          providerId: string;
        }[];
      }) =>
        s.enabledAiModels?.find((model) => model.id === id && model.providerId === provider),
  },
  useAiInfraStore: vi.fn(),
}));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableVisualUnderstanding: (s: { enableVisualUnderstanding: boolean }) =>
      s.enableVisualUnderstanding,
    visualUnderstanding: (s: { visualUnderstanding?: { model: string; provider: string } }) =>
      s.visualUnderstanding,
  },
  useServerConfigStore: vi.fn(),
}));

const mockedUseModelSupportToolUse = vi.mocked(useModelSupportToolUse);
const mockedUseModelSupportVideo = vi.mocked(useModelSupportVideo);
const mockedUseModelSupportVision = vi.mocked(useModelSupportVision);
const mockedUseAiInfraStore = vi.mocked(useAiInfraStore);
const mockedUseServerConfigStore = vi.mocked(useServerConfigStore);

describe('useVisualMediaUploadAbility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseModelSupportVision.mockReturnValue(false);
    mockedUseModelSupportVideo.mockReturnValue(false);
    mockedUseModelSupportToolUse.mockReturnValue(false);
    mockedUseAiInfraStore.mockImplementation((selector) =>
      selector({ enabledAiModels: [] } as any),
    );
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({ enableVisualUnderstanding: false, visualUnderstanding: undefined } as any),
    );
  });

  it('should allow native visual upload without tool use', () => {
    mockedUseModelSupportVision.mockImplementation((id) => id === 'model');

    const { result } = renderHook(() => useVisualMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(false);
  });

  it('should allow fallback visual upload only when tool use is supported', () => {
    mockedUseModelSupportToolUse.mockReturnValue(true);
    mockedUseAiInfraStore.mockImplementation((selector) =>
      selector({
        enabledAiModels: [
          {
            abilities: { video: true, vision: true },
            id: 'fallback-model',
            providerId: 'fallback-provider',
          },
        ],
      } as any),
    );
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({
        enableVisualUnderstanding: true,
        visualUnderstanding: { model: 'fallback-model', provider: 'fallback-provider' },
      } as any),
    );

    const { result } = renderHook(() => useVisualMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should allow fallback visual upload when fallback model abilities are unknown', () => {
    mockedUseModelSupportToolUse.mockReturnValue(true);
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({
        enableVisualUnderstanding: true,
        visualUnderstanding: { model: 'server-only-model', provider: 'server-only-provider' },
      } as any),
    );

    const { result } = renderHook(() => useVisualMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should reject fallback visual upload when tool use is unsupported', () => {
    mockedUseAiInfraStore.mockImplementation((selector) =>
      selector({
        enabledAiModels: [
          {
            abilities: { video: true, vision: true },
            id: 'fallback-model',
            providerId: 'fallback-provider',
          },
        ],
      } as any),
    );
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({
        enableVisualUnderstanding: true,
        visualUnderstanding: { model: 'fallback-model', provider: 'fallback-provider' },
      } as any),
    );

    const { result } = renderHook(() => useVisualMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadImage).toBe(false);
    expect(result.current.canUploadVideo).toBe(false);
  });

  it('should respect fallback model media abilities separately', () => {
    mockedUseModelSupportToolUse.mockReturnValue(true);
    mockedUseAiInfraStore.mockImplementation((selector) =>
      selector({
        enabledAiModels: [
          {
            abilities: { video: false, vision: true },
            id: 'fallback-model',
            providerId: 'fallback-provider',
          },
        ],
      } as any),
    );
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({
        enableVisualUnderstanding: true,
        visualUnderstanding: { model: 'fallback-model', provider: 'fallback-provider' },
      } as any),
    );

    const { result } = renderHook(() => useVisualMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(false);
  });
});
