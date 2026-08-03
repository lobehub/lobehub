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
        {
          avatar?: string | null;
          backgroundColor?: string;
          name?: string;
          slug?: string;
          title?: string;
        }
      >,
    },
    agentStoreListeners: new Set<() => void>(),
    actionIconProps: { all: [] as Record<string, unknown>[] },
    updateAgentSlug: vi.fn(),
    refreshAgentConfig: vi.fn(),
    emojiPickerProps: { last: undefined as Record<string, unknown> | undefined },
    // In edit mode the header renders three inputs, in order: personal name,
    // role, slug. `all` accumulates across renders, so read from the TAIL — the
    // head holds a stale closure and a handler taken from it silently no-ops.
    inputProps: {
      all: [] as Record<string, unknown>[],
      /** The headline input — the personal name. */
      get name() {
        return this.all.at(-3);
      },
      /** The second input — the role (`title`). */
      get role() {
        return this.all.at(-2);
      },
      /** The third input — the url slug. */
      get slug() {
        return this.all.at(-1);
      },
    },
    permissionState: { allowed: false },
    updateAgentMetaById: vi.fn(),
    uploadWithProgress: vi.fn(),
  };
});

vi.mock('@lobehub/ui', () => ({
  ActionIcon: (props: Record<string, unknown>) => {
    mocks.actionIconProps.all.push(props);
    return (
      <button type="button" onClick={props.onClick as () => void}>
        {props.title as string}
      </button>
    );
  },
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Input: (props: Record<string, unknown>) => {
    mocks.inputProps.all.push(props);
    return <input readOnly disabled={props.disabled as boolean} value={props.value as string} />;
  },
  Skeleton: {
    Button: () => <div />,
  },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
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
            internal_refreshAgentConfig: mocks.refreshAgentConfig,
            updateAgentMetaById: mocks.updateAgentMetaById,
          }),
      ),
  };
});

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (agentId: string) => (state: typeof mocks.agentStoreState) =>
      state.agentMap[agentId] || {},
    getAgentSlugById: (agentId: string) => (state: typeof mocks.agentStoreState) =>
      state.agentMap[agentId]?.slug,
  },
}));

vi.mock('@/services/agent', () => ({
  agentService: {
    updateAgentSlug: (...args: unknown[]) => mocks.updateAgentSlug(...args),
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

/** The identity block is read-only until the pencil is clicked. */
const renderEditing = () => {
  const view = render(<AgentHeader />);
  act(() => {
    (mocks.actionIconProps.all[0]?.onClick as () => void)?.();
  });
  return view;
};

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
    mocks.inputProps.all = [];
    mocks.actionIconProps.all = [];
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
    renderEditing();

    act(() => {
      const onChange = mocks.inputProps.role?.onChange as (event: {
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

    // Switching agents leaves edit mode; re-entering it must start from agent-b's
    // own data, not from the draft that was just flushed to agent-a.
    act(() => {
      (mocks.actionIconProps.all.at(-1)?.onClick as () => void)?.();
    });
    expect(mocks.inputProps.role?.value).toBe('Same title');
  });

  it('persists the personal name separately from the role title', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { name: 'Alice', title: 'Health Assistant' } };
    const view = renderEditing();

    // The headline is the personal name; the role sits under it.
    expect(mocks.inputProps.name?.value).toBe('Alice');
    expect(mocks.inputProps.role?.value).toBe('Health Assistant');

    act(() => {
      const onChange = mocks.inputProps.name?.onChange as (event: {
        target: { value: string };
      }) => void;
      onChange({ target: { value: '小艾' } });
    });

    view.unmount();

    expect(mocks.updateAgentMetaById).toHaveBeenCalledExactlyOnceWith('agent-a', {
      name: '小艾',
    });
  });

  it('shows the slug next to the role', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = {
      'agent-a': { name: 'Alice', slug: 'brave-otter-lamp', title: 'Health Assistant' },
    };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).toContain('@brave-otter-lamp');
  });

  it('commits a slug rename through its own endpoint on blur', async () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { name: 'Alice', slug: 'old-slug' } };
    mocks.updateAgentSlug.mockResolvedValue({ success: true });
    renderEditing();

    expect(mocks.inputProps.slug?.value).toBe('old-slug');

    await act(async () => {
      (mocks.inputProps.slug?.onChange as (event: { target: { value: string } }) => void)({
        target: { value: 'New-Slug' },
      });
    });
    await act(async () => {
      await (mocks.inputProps.slug?.onBlur as () => Promise<void>)();
    });

    // Normalized to lowercase, and routed away from the meta patch.
    expect(mocks.updateAgentSlug).toHaveBeenCalledExactlyOnceWith('agent-a', 'new-slug');
    expect(mocks.updateAgentMetaById).not.toHaveBeenCalled();
  });

  it('surfaces a rejected slug instead of silently keeping the draft', async () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { name: 'Alice', slug: 'old-slug' } };
    mocks.updateAgentSlug.mockResolvedValue({ reason: 'taken', success: false });
    const view = renderEditing();

    await act(async () => {
      (mocks.inputProps.slug?.onChange as (event: { target: { value: string } }) => void)({
        target: { value: 'taken-slug' },
      });
    });
    await act(async () => {
      await (mocks.inputProps.slug?.onBlur as () => Promise<void>)();
    });

    expect(view.container.textContent).toContain('settingAgent.slug.error.taken');
  });

  it('flushes a pending title when the scoped profile unmounts', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { title: 'Agent A' } };
    const view = renderEditing();

    act(() => {
      const onChange = mocks.inputProps.role?.onChange as (event: {
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
