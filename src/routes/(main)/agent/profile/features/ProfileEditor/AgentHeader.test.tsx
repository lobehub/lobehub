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
    artworkProps: { last: undefined as Record<string, unknown> | undefined },
    createAgentIdentityModal: vi.fn(),
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
    randomAgentName: vi.fn(() => 'Zoe'),
    refreshAgentList: vi.fn(),
    sidebarAgents: [] as { id: string; name?: string | null }[],
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
  Button: (props: Record<string, unknown>) => (
    <button type="button" onClick={props.onClick as () => void}>
      {props.children as ReactNode}
    </button>
  ),
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

vi.mock('@/features/AgentProfileArtwork', () => ({
  AgentProfileArtwork: (props: Record<string, unknown>) => {
    mocks.artworkProps.last = props;
    return <div>artwork</div>;
  },
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

vi.mock('@/store/agent/projection', async () => {
  const { useSyncExternalStore } = await import('react');
  const useProjectedAgent = <T,>(agentId: string, selector: (agent: Record<string, any>) => T) =>
    useSyncExternalStore(
      (listener) => {
        mocks.agentStoreListeners.add(listener);
        return () => mocks.agentStoreListeners.delete(listener);
      },
      () => selector(mocks.agentStoreState.agentMap[agentId] || {}),
    );

  return {
    agentProjectionSelectors: {
      slug: (agent: { slug?: string }) => agent.slug,
    },
    useAgentConfig: (agentId: string) => useProjectedAgent(agentId, (agent) => agent),
    useAgentMeta: (agentId: string) => useProjectedAgent(agentId, (agent) => agent),
    useAgentValue: (agentId: string, selector: (agent: Record<string, any>) => unknown) =>
      useProjectedAgent(agentId, selector),
  };
});

vi.mock('@/features/AgentIdentityModal', () => ({
  createAgentIdentityModal: (...args: unknown[]) => mocks.createAgentIdentityModal(...args),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  randomAgentName: (...args: unknown[]) => mocks.randomAgentName(...(args as [])),
}));

vi.mock('@/store/home', () => {
  const useHomeStore = (selector: (state: unknown) => unknown) =>
    selector({ refreshAgentList: mocks.refreshAgentList });
  useHomeStore.getState = () => ({ agents: mocks.sidebarAgents });
  return { useHomeStore };
});

vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    allAgents: (state: { agents: unknown[] }) => state.agents,
  },
}));

vi.mock('@/projection/modules/home/sidebarHooks', () => ({
  getHomeSidebarProjection: () => mocks.sidebarAgents,
  homeSidebarSelectors: {
    allAgents: (agents: typeof mocks.sidebarAgents) => agents,
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
    mocks.inputProps.all = [];
    mocks.actionIconProps.all = [];
    mocks.artworkProps.last = undefined;
    mocks.permissionState.allowed = false;
    mocks.randomAgentName.mockReturnValue('Zoe');
    mocks.sidebarAgents = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the artwork editor read-only when edits are not allowed', () => {
    render(<AgentHeader />);

    expect(mocks.artworkProps.last?.canEdit).toBe(false);
  });

  it('opens the identity form instead of editing inline', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { name: 'Alice', title: 'Health Assistant' } };
    const view = render(<AgentHeader />);

    // The header is display-only: the three fields live in the modal.
    expect(view.container.querySelectorAll('input')).toHaveLength(0);

    act(() => {
      (mocks.actionIconProps.all.at(-1)?.onClick as () => void)?.();
    });

    expect(mocks.createAgentIdentityModal).toHaveBeenCalledExactlyOnceWith('agent-a');
  });

  it('shows the slug next to the role', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = {
      'agent-a': { name: 'Alice', slug: 'brave-otter-lamp', title: 'Health Assistant' },
    };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).toContain('@brave-otter-lamp');
  });

  // Regression: the headline used to fall back to the name field's PLACEHOLDER,
  // so every unnamed agent read as though it were called "Give it a name, …".
  it('never renders the input placeholder as a headline', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { slug: 'experiment-crop-then' } };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).not.toContain('settingAgent.personalName.placeholder');
  });

  // The headline is the NAME slot. Borrowing the role printed it twice, since
  // the role already has its own line right below.
  it('does not borrow the role for the headline', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { slug: 'inbox', title: 'Lobe AI' } };
    const view = render(<AgentHeader />);

    // Exactly once: on the role line, never as the headline.
    expect(view.container.textContent?.match(/Lobe AI/g)).toHaveLength(1);
  });

  // With no name there is nothing to headline, so the slot carries the prompt
  // that fixes it — not a placeholder dressed up as a name.
  it('gives the headline slot to the naming prompt while unnamed', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { slug: 'inbox', title: 'Lobe AI' } };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).toContain('settingAgent.personalName.unnamed');
    expect(view.container.textContent).not.toContain('settingAgent.identity.untitled');
    // Naming it IS the next step; the identity form would split attention.
    expect(view.container.textContent).not.toContain('settingAgent.identity.edit');
  });

  // Read-only viewers get the plain label — an action they cannot take would be
  // worse than a stated absence.
  it('falls back to the unnamed label when edits are not allowed', () => {
    mocks.agentStoreState.agentMap = { 'agent-a': { slug: 'inbox', title: 'Lobe AI' } };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).toContain('settingAgent.identity.untitled');
    expect(view.container.textContent).not.toContain('settingAgent.personalName.pickForMe');
    expect(view.container.textContent).not.toContain('settingAgent.identity.edit');
  });

  it('restores the headline and the edit affordance once named', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { name: '思远', slug: 'inbox' } };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).toContain('思远');
    expect(view.container.textContent).not.toContain('settingAgent.personalName.unnamed');
    expect(view.container.textContent).toContain('settingAgent.identity.edit');
  });

  it('states the role is unset instead of leaving a bare slug', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { name: '思远', slug: 'belong-pot-women' } };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).toContain('settingAgent.role.unset');
    expect(view.container.textContent).toContain('@belong-pot-women');
  });

  it('offers one-click naming for an agent with no name', async () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { title: 'Health Assistant' } };
    mocks.sidebarAgents = [
      { id: 'agent-a', name: null },
      { id: 'agent-b', name: 'Alice' },
      { id: 'agent-c', name: 'Leo' },
      { id: 'agent-d', name: null },
    ];
    const view = render(<AgentHeader />);

    expect(view.container.textContent).toContain('settingAgent.personalName.unnamed');
    const button = [...view.container.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('settingAgent.personalName.pickForMe'),
    );

    await act(async () => {
      button?.click();
    });

    // Names already on screen are excluded — a second "Alice" would defeat the
    // point of having a name at all.
    expect(mocks.randomAgentName).toHaveBeenCalledExactlyOnceWith('en-US', ['Alice', 'Leo']);
    expect(mocks.updateAgentMetaById).toHaveBeenCalledExactlyOnceWith('agent-a', { name: 'Zoe' });
    // Otherwise the sidebar keeps showing the unnamed label next to a now-named
    // profile.
    expect(mocks.refreshAgentList).toHaveBeenCalledOnce();
  });

  it('does not offer naming for an agent that already has one', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = { 'agent-a': { name: 'Alice', title: 'Health Assistant' } };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).not.toContain('settingAgent.personalName.pickForMe');
  });

  it('does not offer naming when edits are not allowed', () => {
    mocks.agentStoreState.agentMap = { 'agent-a': { title: 'Health Assistant' } };
    const view = render(<AgentHeader />);

    expect(view.container.textContent).not.toContain('settingAgent.personalName.pickForMe');
  });

  it('keeps an artwork update bound to the agent that started it', () => {
    mocks.permissionState.allowed = true;
    mocks.agentStoreState.agentMap = {
      'agent-a': { title: 'Agent A' },
      'agent-b': { title: 'Agent B' },
    };
    render(<AgentHeader />);
    const onAvatarChange = mocks.artworkProps.last?.onAvatarChange as (avatar: string) => void;

    act(() => {
      mocks.agentStoreState.activeAgentId = 'agent-b';
      mocks.agentStoreListeners.forEach((listener) => listener());
    });

    act(() => {
      onAvatarChange('https://example.com/agent-a.png');
    });

    expect(mocks.updateAgentMetaById).toHaveBeenCalledExactlyOnceWith('agent-a', {
      avatar: 'https://example.com/agent-a.png',
    });
  });
});
