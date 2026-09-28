import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useOpenAcceptanceInPanel } from './useOpenAcceptanceInPanel';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openAcceptance: vi.fn(),
  toggleTaskAgentPanel: vi.fn(),
}));

// The hook must NOT route anywhere: `/acceptance/:id` is a public,
// workspace-less page and navigating there drops the workspace slug
// The navigate hook is mocked only to prove it stays unused.
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openAcceptance: mocks.openAcceptance }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ toggleTaskAgentPanel: mocks.toggleTaskAgentPanel }),
}));

describe('useOpenAcceptanceInPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the acceptance in the task panel instead of navigating away from the workspace', () => {
    const { result } = renderHook(() => useOpenAcceptanceInPanel());

    result.current('acc_1');

    expect(mocks.toggleTaskAgentPanel).toHaveBeenCalledWith(true);
    expect(mocks.openAcceptance).toHaveBeenCalledWith('acc_1');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('keeps a stable callback across re-renders', () => {
    const { rerender, result } = renderHook(() => useOpenAcceptanceInPanel());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
