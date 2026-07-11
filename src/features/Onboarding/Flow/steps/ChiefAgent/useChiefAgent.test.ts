import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChiefAgent } from './useChiefAgent';

const mocks = vi.hoisted(() => ({
  agentState: {
    agentMap: {} as Record<string, { avatar?: string; title?: string }>,
    optimisticUpdateAgentMeta: vi.fn().mockResolvedValue(undefined),
    saveStatus: 'saved' as 'idle' | 'saving' | 'saved',
    useInitBuiltinAgent: vi.fn(),
  },
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.toastError },
}));

vi.mock('@/store/agent', () => {
  const useAgentStore = (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState);
  useAgentStore.getState = () => mocks.agentState;

  return { useAgentStore };
});

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (agentId: string) => (state: typeof mocks.agentState) =>
      state.agentMap[agentId] ?? {},
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  mocks.agentState.agentMap = {};
  mocks.agentState.saveStatus = 'saved';
  mocks.agentState.optimisticUpdateAgentMeta.mockClear().mockImplementation(async () => {
    mocks.agentState.saveStatus = 'saved';
  });
  mocks.agentState.useInitBuiltinAgent.mockClear();
  mocks.toastError.mockClear();
});

describe('useChiefAgent', () => {
  it('falls back to the i18n default name when the inbox agent has no title yet', () => {
    const { result } = renderHook(() => useChiefAgent({ next: vi.fn() }));

    expect(result.current.name).toBe('flow.steps.chiefAgent.defaultName');
  });

  it('seeds name and avatar from the existing inbox agent meta', () => {
    mocks.agentState.agentMap.inbox = { avatar: '🦊', title: 'Rusty' };

    const { result } = renderHook(() => useChiefAgent({ next: vi.fn() }));

    expect(result.current.name).toBe('Rusty');
    expect(result.current.avatar).toBe('🦊');
  });

  it('derives the display handle from a slugified name', () => {
    const { result } = renderHook(() => useChiefAgent({ next: vi.fn() }));

    act(() => result.current.setName('Cool Bot!!'));

    expect(result.current.handle).toBe('cool-bot@lobe.id');
  });

  it('persists title and avatar then advances on hire', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useChiefAgent({ next }));

    act(() => {
      result.current.setName('Rusty');
      result.current.setAvatar('🦊');
    });

    await act(async () => {
      await result.current.hire();
    });

    expect(mocks.agentState.optimisticUpdateAgentMeta).toHaveBeenCalledWith('inbox', {
      avatar: '🦊',
      title: 'Rusty',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('exposes a loading flag while hiring is in flight', async () => {
    let resolvePersist: () => void = () => {};
    mocks.agentState.optimisticUpdateAgentMeta.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePersist = resolve;
      }),
    );
    const next = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useChiefAgent({ next }));

    let hirePromise!: Promise<void>;
    act(() => {
      hirePromise = result.current.hire();
    });

    expect(result.current.hiring).toBe(true);

    await act(async () => {
      resolvePersist();
      await hirePromise;
    });

    expect(result.current.hiring).toBe(false);
  });

  it('does not advance and shows a toast when the persist fails', async () => {
    mocks.agentState.optimisticUpdateAgentMeta.mockImplementation(async () => {
      mocks.agentState.saveStatus = 'idle';
    });
    const next = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useChiefAgent({ next }));

    await act(async () => {
      await result.current.hire();
    });

    expect(next).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(result.current.hiring).toBe(false);
  });

  it('does not advance and shows a toast when next() rejects', async () => {
    const next = vi.fn().mockRejectedValue(new Error('navigation failed'));
    const { result } = renderHook(() => useChiefAgent({ next }));

    await act(async () => {
      await result.current.hire();
    });

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(result.current.hiring).toBe(false);
  });

  it('keeps a user edit made before the inbox agent meta resolves', () => {
    const { result, rerender } = renderHook(() => useChiefAgent({ next: vi.fn() }));

    act(() => result.current.setName('My Custom Name'));

    mocks.agentState.agentMap.inbox = { avatar: '🦊', title: 'Rusty' };
    rerender();

    expect(result.current.name).toBe('My Custom Name');
    expect(result.current.avatar).not.toBe('🦊');
  });
});
