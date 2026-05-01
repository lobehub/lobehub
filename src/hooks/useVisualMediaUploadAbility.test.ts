import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useModelSupportVideo } from '@/hooks/useModelSupportVideo';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useServerConfigStore } from '@/store/serverConfig';

import { useVisualMediaUploadAbility } from './useVisualMediaUploadAbility';

vi.mock('@/hooks/useModelSupportToolUse');
vi.mock('@/hooks/useModelSupportVideo');
vi.mock('@/hooks/useModelSupportVision');
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
const mockedUseServerConfigStore = vi.mocked(useServerConfigStore);

describe('useVisualMediaUploadAbility', () => {
  beforeEach(() => {
    mockedUseModelSupportVision.mockReturnValue(false);
    mockedUseModelSupportVideo.mockReturnValue(false);
    mockedUseModelSupportToolUse.mockReturnValue(false);
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
    mockedUseModelSupportVision.mockImplementation((id) => id === 'fallback-model');
    mockedUseModelSupportVideo.mockImplementation((id) => id === 'fallback-model');
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

  it('should reject fallback visual upload when tool use is unsupported', () => {
    mockedUseModelSupportVision.mockImplementation((id) => id === 'fallback-model');
    mockedUseModelSupportVideo.mockImplementation((id) => id === 'fallback-model');
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
    mockedUseModelSupportVision.mockImplementation((id) => id === 'fallback-model');
    mockedUseModelSupportVideo.mockReturnValue(false);
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
