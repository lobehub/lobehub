import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelSupportAudio } from '@/hooks/useModelSupportAudio';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useModelSupportVideo } from '@/hooks/useModelSupportVideo';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useAiInfraStore } from '@/store/aiInfra';
import { useServerConfigStore } from '@/store/serverConfig';

import { useMediaUploadAbility } from './useMediaUploadAbility';

vi.mock('@/hooks/useModelSupportAudio');
vi.mock('@/hooks/useModelSupportToolUse');
vi.mock('@/hooks/useModelSupportVideo');
vi.mock('@/hooks/useModelSupportVision');
const projection = vi.hoisted(() => ({ agent: undefined as Record<string, unknown> | undefined }));
vi.mock('@/store/agent/projection', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAgentValue: (
    _id: string | undefined,
    selector: (agent?: Record<string, unknown>) => unknown,
  ) => selector(projection.agent),
}));
vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    getEnabledModelById:
      (id: string, provider: string) =>
      (s: {
        enabledAiModels?: {
          abilities: { audio?: boolean; video?: boolean; vision?: boolean };
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
    enableMultimodalUnderstanding: (s: { enableMultimodalUnderstanding: boolean }) =>
      s.enableMultimodalUnderstanding,
    multimodalUnderstanding: (s: {
      multimodalUnderstanding?: { model: string; provider: string };
    }) => s.multimodalUnderstanding,
  },
  useServerConfigStore: vi.fn(),
}));

const mockedUseModelSupportAudio = vi.mocked(useModelSupportAudio);
const mockedUseModelSupportToolUse = vi.mocked(useModelSupportToolUse);
const mockedUseModelSupportVideo = vi.mocked(useModelSupportVideo);
const mockedUseModelSupportVision = vi.mocked(useModelSupportVision);
const mockedUseAiInfraStore = vi.mocked(useAiInfraStore);
const mockedUseServerConfigStore = vi.mocked(useServerConfigStore);

describe('useMediaUploadAbility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseModelSupportAudio.mockReturnValue(false);
    mockedUseModelSupportVision.mockReturnValue(false);
    mockedUseModelSupportVideo.mockReturnValue(false);
    mockedUseModelSupportToolUse.mockReturnValue(false);
    projection.agent = undefined;
    mockedUseAiInfraStore.mockImplementation((selector) =>
      selector({ enabledAiModels: [] } as any),
    );
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({ enableMultimodalUnderstanding: false, multimodalUnderstanding: undefined } as any),
    );
  });

  it('should allow native image upload without tool use', () => {
    mockedUseModelSupportVision.mockImplementation((id) => id === 'model');

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadAudio).toBe(false);
    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(false);
  });

  it('should allow fallback media upload only when tool use is supported', () => {
    mockedUseModelSupportToolUse.mockReturnValue(true);
    mockedUseAiInfraStore.mockImplementation((selector) =>
      selector({
        enabledAiModels: [
          {
            abilities: { audio: true, video: true, vision: true },
            id: 'fallback-model',
            providerId: 'fallback-provider',
          },
        ],
      } as any),
    );
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({
        enableMultimodalUnderstanding: true,
        multimodalUnderstanding: { model: 'fallback-model', provider: 'fallback-provider' },
      } as any),
    );

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadAudio).toBe(true);
    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should allow fallback media upload when fallback model abilities are unknown', () => {
    mockedUseModelSupportToolUse.mockReturnValue(true);
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({
        enableMultimodalUnderstanding: true,
        multimodalUnderstanding: { model: 'server-only-model', provider: 'server-only-provider' },
      } as any),
    );

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadAudio).toBe(true);
    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should reject fallback media upload when tool use is unsupported', () => {
    mockedUseAiInfraStore.mockImplementation((selector) =>
      selector({
        enabledAiModels: [
          {
            abilities: { audio: true, video: true, vision: true },
            id: 'fallback-model',
            providerId: 'fallback-provider',
          },
        ],
      } as any),
    );
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({
        enableMultimodalUnderstanding: true,
        multimodalUnderstanding: { model: 'fallback-model', provider: 'fallback-provider' },
      } as any),
    );

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadAudio).toBe(false);
    expect(result.current.canUploadImage).toBe(false);
    expect(result.current.canUploadVideo).toBe(false);
  });

  it('should respect fallback model media abilities separately', () => {
    mockedUseModelSupportToolUse.mockReturnValue(true);
    mockedUseAiInfraStore.mockImplementation((selector) =>
      selector({
        enabledAiModels: [
          {
            abilities: { audio: false, video: false, vision: true },
            id: 'fallback-model',
            providerId: 'fallback-provider',
          },
        ],
      } as any),
    );
    mockedUseServerConfigStore.mockImplementation((selector) =>
      selector({
        enableMultimodalUnderstanding: true,
        multimodalUnderstanding: { model: 'fallback-model', provider: 'fallback-provider' },
      } as any),
    );

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider'));

    expect(result.current.canUploadAudio).toBe(false);
    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(false);
  });

  it('should bypass the media gate in agent mode regardless of model abilities', () => {
    projection.agent = { chatConfig: { enableAgentMode: true } };

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider', 'agent-1'));

    expect(result.current.canUploadAudio).toBe(true);
    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should bypass the media gate for heterogeneous agents', () => {
    projection.agent = {
      agencyConfig: { heterogeneousProvider: { type: 'codex' } },
      chatConfig: { enableAgentMode: false },
    };

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider', 'agent-1'));

    expect(result.current.canUploadAudio).toBe(true);
    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should reject image uploads for Kimi Code agents', () => {
    projection.agent = {
      agencyConfig: { heterogeneousProvider: { type: 'kimi-code' } },
      chatConfig: { enableAgentMode: false },
    };

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider', 'agent-1'));

    expect(result.current.canUploadAudio).toBe(true);
    expect(result.current.canUploadImage).toBe(false);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should not bypass the media gate when agent mode is explicitly disabled', () => {
    mockedUseModelSupportAudio.mockReturnValue(false);
    projection.agent = { chatConfig: { enableAgentMode: false } };

    const { result } = renderHook(() => useMediaUploadAbility('model', 'provider', 'agent-1'));

    expect(result.current.canUploadAudio).toBe(false);
    expect(result.current.canUploadImage).toBe(false);
    expect(result.current.canUploadVideo).toBe(false);
  });
});
