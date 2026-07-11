/**
 * @vitest-environment happy-dom
 */
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentHeader from './AgentHeader';

const mocks = vi.hoisted(() => {
  return {
    agentStoreState: {
      activeAgentId: 'agent-a',
      agentMap: {} as Record<
        string,
        { avatar?: string | null; backgroundColor?: string; title?: string }
      >,
    },
    agentStoreListeners: new Set<() => void>(),
    emojiPickerProps: { last: undefined as Record<string, unknown> | undefined },
    inputProps: { last: undefined as Record<string, unknown> | undefined },
    permissionState: { allowed: false },
    updateAgentMetaById: vi.fn(),
    uploadWithProgress: vi.fn(),
  };
});

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Input: (props: Record<string, unknown>) => {
    mocks.inputProps.last = props;
    return <input readOnly disabled={props.disabled as boolean} value={props.value as string} />;
  },
  Skeleton: {
    Button: () => <div />,
  },
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('antd', () => ({
  message: { error: vi.fn() },
}));

vi.mock('@/components/EmojiPicker', () => ({
  default: vi.fn((props: Record<string, unknown>) => {
    mocks.emojiPickerProps.last = props;
    return <button type="button">avatar</button>;
  }),
}));

vi.mock('@/features/AgentSetting/AgentMeta/BackgroundSwatches', () => ({
  default: () => <div />,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.permissionState.allowed, reason: 'requires member' }),
}));

vi.mock('@/store/agent', async () => {
  const { useSyncExternalStore } = await import('react');

  return {
    useAgentStore: (selector: (state: unknown) => unknown) =>
      useSyncExternalStore(
        (listener) => {
          mocks.agentStoreListeners.add(listener);
          return () => mocks.agentStoreListeners.delete(listener);
        },
        () =>
          selector({
            ...mocks.agentStoreState,
            updateAgentMetaById: mocks.updateAgentMetaById,
          }),
      ),
  };
});

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (agentId: string) => (state: typeof mocks.agentStoreState) =>
      state.agentMap[agentId] || {},
  },
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: unknown) => unknown) =>
    selector({ uploadWithProgress: mocks.uploadWithProgress }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) => selector({ language: 'en-US' }),
}));

vi.mock('@/store/global/selectors', () => ({
  globalGeneralSelectors: {
    currentLanguage: (state: { language: string }) => state.language,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('AgentHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.agentStoreState.activeAgentId = 'agent-a';
    mocks.agentStoreState.agentMap = {
      'agent-a': {
        avatar: '🍷',
        title: 'Readonly agent',
      },
    };
    mocks.agentStoreListeners.clear();
    mocks.emojiPickerProps.last = undefined;
    mocks.inputProps.last = undefined;
    mocks.permissionState.allowed = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the emoji picker closed when edits are not allowed', () => {
    render(<AgentHeader />);

    expect(mocks.emojiPickerProps.last?.open).toBe(false);
  });

  it('flushes a pending title to its original agent and resets the next agent input', async () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = {
      'agent-a': { title: 'Same title' },
      'agent-b': { title: 'Same title' },
    };
    render(<AgentHeader />);

    act(() => {
      const onChange = mocks.inputProps.last?.onChange as (event: {
        target: { value: string };
      }) => void;
      onChange({ target: { value: 'Agent A draft' } });
    });

    expect(mocks.updateAgentMetaById).not.toHaveBeenCalled();

    act(() => {
      mocks.agentStoreState.activeAgentId = 'agent-b';
      mocks.agentStoreListeners.forEach((listener) => listener());
    });

    expect(mocks.updateAgentMetaById).toHaveBeenCalledExactlyOnceWith('agent-a', {
      title: 'Agent A draft',
    });
    expect(mocks.inputProps.last?.value).toBe('Same title');
  });

  it('flushes a pending title when the scoped profile unmounts', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { title: 'Agent A' } };
    const view = render(<AgentHeader />);

    act(() => {
      const onChange = mocks.inputProps.last?.onChange as (event: {
        target: { value: string };
      }) => void;
      onChange({ target: { value: 'Final Agent A title' } });
    });

    view.unmount();

    expect(mocks.updateAgentMetaById).toHaveBeenCalledExactlyOnceWith('agent-a', {
      title: 'Final Agent A title',
    });
    act(() => vi.runAllTimers());
    expect(mocks.updateAgentMetaById).toHaveBeenCalledTimes(1);
  });

  it('keeps an asynchronous avatar upload bound to the agent that started it', async () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = {
      'agent-a': { title: 'Agent A' },
      'agent-b': { title: 'Agent B' },
    };
    let resolveUpload: ((result: { url: string }) => void) | undefined;
    mocks.uploadWithProgress.mockImplementation(
      () =>
        new Promise<{ url: string }>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    render(<AgentHeader />);
    const upload = mocks.emojiPickerProps.last?.onUpload as (file: File) => Promise<void>;
    const uploadPromise = upload(new File(['avatar'], 'avatar.png', { type: 'image/png' }));

    act(() => {
      mocks.agentStoreState.activeAgentId = 'agent-b';
      mocks.agentStoreListeners.forEach((listener) => listener());
    });

    await act(async () => {
      resolveUpload?.({ url: 'https://example.com/agent-a.png' });
      await uploadPromise;
    });

    expect(mocks.updateAgentMetaById).toHaveBeenCalledExactlyOnceWith('agent-a', {
      avatar: 'https://example.com/agent-a.png',
    });
  });
});
