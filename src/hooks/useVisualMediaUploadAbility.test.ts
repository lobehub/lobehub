import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelSupportAudio } from '@/hooks/useModelSupportAudio';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useModelSupportVideo } from '@/hooks/useModelSupportVideo';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';
import { useServerConfigStore } from '@/store/serverConfig';

import { useVisualMediaUploadAbility } from './useVisualMediaUploadAbility';

vi.mock('@/hooks/useModelSupportAudio');
vi.mock('@/hooks/useModelSupportToolUse');
vi.mock('@/hooks/useModelSupportVideo');
vi.mock('@/hooks/useModelSupportVision');
vi.mock('@/store/agent', () => ({ useAgentStore: vi.fn() }));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentEnableModeById: (_id: string) => (s: { enableMode?: boolean }) => !!s.enableMode,
    isAgentHeterogeneousById: (_id: string) => (s: { heterogeneous?: boolean }) =>
      !!s.heterogeneous,
  },
}));
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

const mockedUseModelSupportAudio = vi.mocked(useModelSupportAudio);
const mockedUseModelSupportToolUse = vi.mocked(useModelSupportToolUse);
const mockedUseModelSupportVideo = vi.mocked(useModelSupportVideo);
const mockedUseModelSupportVision = vi.mocked(useModelSupportVision);
const mockedUseAgentStore = vi.mocked(useAgentStore);
const mockedUseAiInfraStore = vi.mocked(useAiInfraStore);
const mockedUseServerConfigStore = vi.mocked(useServerConfigStore);

describe('useVisualMediaUploadAbility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseModelSupportAudio.mockReturnValue(false);
    mockedUseModelSupportVision.mockReturnValue(false);
    mockedUseModelSupportVideo.mockReturnValue(false);
    mockedUseModelSupportToolUse.mockReturnValue(false);
    // Default: no agent-mode bypass (plain chat).
    mockedUseAgentStore.mockImplementation((selector: any) =>
      selector({ enableMode: false, heterogeneous: false } as any),
    );
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

  it('should bypass the media gate in agent mode regardless of model abilities', () => {
    mockedUseAgentStore.mockImplementation((selector: any) =>
      selector({ enableMode: true, heterogeneous: false } as any),
    );

    const { result } = renderHook(() =>
      useVisualMediaUploadAbility('model', 'provider', 'agent-1'),
    );

    expect(result.current.canUploadAudio).toBe(true);
    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should bypass the media gate for heterogeneous agents', () => {
    mockedUseAgentStore.mockImplementation((selector: any) =>
      selector({ enableMode: false, heterogeneous: true } as any),
    );

    const { result } = renderHook(() =>
      useVisualMediaUploadAbility('model', 'provider', 'agent-1'),
    );

    expect(result.current.canUploadAudio).toBe(true);
    expect(result.current.canUploadImage).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it('should not bypass the media gate when agent mode is explicitly disabled', () => {
    mockedUseModelSupportAudio.mockReturnValue(false);
    mockedUseAgentStore.mockImplementation((selector: any) =>
      selector({ enableMode: false, heterogeneous: false } as any),
    );

    const { result } = renderHook(() =>
      useVisualMediaUploadAbility('model', 'provider', 'agent-1'),
    );

    expect(result.current.canUploadAudio).toBe(false);
    expect(result.current.canUploadImage).toBe(false);
    expect(result.current.canUploadVideo).toBe(false);
  });
});
