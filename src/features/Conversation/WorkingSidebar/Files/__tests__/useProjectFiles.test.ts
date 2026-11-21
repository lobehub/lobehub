import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  options: undefined as { refreshInterval?: number; revalidateOnFocus?: boolean } | undefined,
}));

vi.mock('@lobechat/const', () => ({ isDesktop: true }));
vi.mock('@/store/chat', () => ({ useChatStore: () => true }));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: { isAgentRuntimeRunning: Symbol('isAgentRuntimeRunning') },
}));
vi.mock('@/store/projectFile', () => ({
  projectFileActions: {
    useFetchProjectIndex: (
      _params: unknown,
      options: { refreshInterval?: number; revalidateOnFocus?: boolean },
    ): {
      error: undefined;
      isHydrated: boolean;
      isValidating: boolean;
      revalidate: () => void;
    } => {
      captured.options = options;
      return {
        error: undefined,
        isHydrated: true,
        isValidating: false,
        revalidate: vi.fn(),
      };
    },
  },
  projectIndexResource: { key: (params: unknown) => JSON.stringify(params) },
  useProjectFileStore: (selector: (state: { projectIndex: Record<string, never> }) => unknown) =>
    selector({ projectIndex: {} }),
}));

const { useProjectFiles } = await import('../useProjectFiles');

describe('useProjectFiles — sandbox live polling', () => {
  it('polls a running sandbox only when the caller allows live reads', () => {
    const { rerender } = renderHook(
      ({ live }: { live: boolean }) =>
        useProjectFiles(undefined, '', { instanceId: 'instance-1', live }),
      { initialProps: { live: true } },
    );

    expect(captured.options?.refreshInterval).toBe(15_000);
    expect(captured.options?.revalidateOnFocus).toBe(true);

    // The hidden prefetch warms the tree once instead of walking the workspace
    // every interval or on every app focus until the run ends.
    rerender({ live: false });
    expect(captured.options?.refreshInterval).toBe(0);
    expect(captured.options?.revalidateOnFocus).toBe(false);
  });
});
