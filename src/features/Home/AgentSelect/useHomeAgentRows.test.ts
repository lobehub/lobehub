/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHomeAgentRows } from './useHomeAgentRows';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: undefined as string | undefined,
  agentState: {
    agentMap: {} as Record<string, unknown>,
    builtinAgentIdMap: { inbox: 'agt_inbox' } as Record<string, string>,
  },
  currentUserId: 'member-1',
  homeState: {
    agentGroups: [] as any[],
    pinnedAgents: [] as any[],
    privateAgentGroups: [] as any[],
    privatePinnedAgents: [] as any[],
    privateUngroupedAgents: [] as any[],
    ungroupedAgents: [] as any[],
  },
  sidebarHiddenAgentIds: [] as string[],
  sidebarHiddenGroupIds: [] as string[],
  sidebarVisibilityOverrides: {} as Record<string, boolean>,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (id: string) => (state: typeof mocks.agentState) =>
      (state.agentMap[id] as Record<string, unknown> | undefined) ?? {},
  },
  builtinAgentSelectors: {
    inboxAgentId: (state: typeof mocks.agentState) => state.builtinAgentIdMap.inbox,
  },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: typeof mocks.homeState) => unknown) => selector(mocks.homeState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({
      preference: {
        sidebarHiddenAgentIds: mocks.sidebarHiddenAgentIds,
        sidebarHiddenGroupIds: mocks.sidebarHiddenGroupIds,
      },
      updatePreference: vi.fn(),
      updateWorkspaceUserPreference: vi.fn(),
      userId: mocks.currentUserId,
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  workspaceUserSettingsSelectors: {
    // `useKeepSidebarGroupsListed` reaches through to the group-visibility
    // hook, which now gates writes on the loaded preference workspace.
    preferenceWorkspaceId: () => mocks.activeWorkspaceId ?? null,
    sidebarAgentVisibilityOverrides: () => mocks.sidebarVisibilityOverrides,
    sidebarHiddenAgentIds: () => mocks.sidebarHiddenAgentIds,
    sidebarHiddenGroupIds: () => mocks.sidebarHiddenGroupIds,
  },
  userProfileSelectors: { userId: (state: { userId: string }) => state.userId },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { agentPageSize: () => 10 },
}));

const agent = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  type: 'agent',
  userId: 'member-1',
  ...extra,
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe('useHomeAgentRows', () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = undefined;
    mocks.currentUserId = 'member-1';
    mocks.sidebarHiddenAgentIds = [];
    mocks.sidebarHiddenGroupIds = [];
    mocks.sidebarVisibilityOverrides = {};
    mocks.agentState.agentMap = { agt_inbox: { title: 'Lobe AI' } };
    mocks.homeState.agentGroups = [];
    mocks.homeState.pinnedAgents = [];
    mocks.homeState.privateAgentGroups = [];
    mocks.homeState.privatePinnedAgents = [];
    mocks.homeState.privateUngroupedAgents = [];
    mocks.homeState.ungroupedAgents = [];
  });

  it('drops agents the caller removed from their sidebar', () => {
    mocks.homeState.ungroupedAgents = [agent('agt_a', 'Visible'), agent('agt_b', 'Hidden')];
    mocks.sidebarHiddenAgentIds = ['agt_b'];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(ids(result.current.workspaceRows)).toEqual(['agt_inbox', 'agt_a']);
  });

  it('drops hidden private agents too', () => {
    mocks.activeWorkspaceId = 'ws_1';
    mocks.homeState.privateUngroupedAgents = [
      agent('agt_p1', 'Private Kept'),
      agent('agt_p2', 'Private Hidden'),
    ];
    mocks.sidebarHiddenAgentIds = ['agt_p2'];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(ids(result.current.privateRows)).toEqual(['agt_p1']);
  });

  it('splits private and workspace buckets inside a workspace', () => {
    mocks.activeWorkspaceId = 'ws_1';
    mocks.homeState.privateUngroupedAgents = [agent('agt_p', 'Private')];
    mocks.homeState.ungroupedAgents = [agent('agt_a', 'Shared')];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(result.current.showPrivateSection).toBe(true);
    expect(ids(result.current.privateRows)).toEqual(['agt_p']);
    expect(ids(result.current.workspaceRows)).toEqual(['agt_inbox', 'agt_a']);
  });

  it("lists another member's Agent by default and hides it after an explicit override", () => {
    mocks.activeWorkspaceId = 'ws_1';
    mocks.homeState.ungroupedAgents = [
      agent('agt_own', 'Own'),
      agent('agt_shared', 'Shared', { userId: 'member-2' }),
    ];

    const { rerender, result } = renderHook(() => useHomeAgentRows());

    expect(ids(result.current.workspaceRows)).toEqual(['agt_inbox', 'agt_own', 'agt_shared']);

    mocks.sidebarVisibilityOverrides = { agt_shared: false };
    rerender();

    expect(ids(result.current.workspaceRows)).toEqual(['agt_inbox', 'agt_own']);
  });

  it('drops the agents inside a Category the caller hid', () => {
    mocks.activeWorkspaceId = 'ws_1';
    mocks.homeState.agentGroups = [
      { id: 'grp_shown', items: [agent('agt_shown', 'Shown')], name: 'Shown' },
      { id: 'grp_hidden', items: [agent('agt_in_hidden', 'In hidden')], name: 'Hidden' },
    ];
    mocks.sidebarHiddenGroupIds = ['grp_hidden'];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(ids(result.current.workspaceRows)).toEqual(['agt_inbox', 'agt_shown']);
  });

  it('keeps a single flat bucket in personal mode', () => {
    mocks.homeState.ungroupedAgents = [agent('agt_a', 'Shared')];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(result.current.showPrivateSection).toBe(false);
    expect(result.current.privateRows).toEqual([]);
  });

  it('hides the private section when every private agent is hidden', () => {
    mocks.activeWorkspaceId = 'ws_1';
    mocks.homeState.privateUngroupedAgents = [agent('agt_p', 'Private')];
    mocks.sidebarHiddenAgentIds = ['agt_p'];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(result.current.showPrivateSection).toBe(false);
    expect(result.current.privateRows).toEqual([]);
  });

  it('orders each bucket pinned → folders → ungrouped and de-duplicates by id', () => {
    mocks.homeState.pinnedAgents = [agent('agt_pinned', 'Pinned', { pinned: true })];
    mocks.homeState.agentGroups = [
      {
        id: 'grp_1',
        items: [agent('agt_pinned', 'Pinned', { pinned: true }), agent('agt_folder', 'In Folder')],
        name: 'Folder',
      },
    ];
    mocks.homeState.ungroupedAgents = [agent('agt_plain', 'Plain')];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(ids(result.current.workspaceRows)).toEqual([
      'agt_inbox',
      'agt_pinned',
      'agt_folder',
      'agt_plain',
    ]);
    expect(result.current.workspaceRows.find((row) => row.id === 'agt_pinned')?.pinned).toBe(true);
  });

  it('keeps the agent role as the secondary row title', () => {
    mocks.homeState.ungroupedAgents = [
      agent('agt_codex', 'Codex', { name: 'Coco' }),
      agent('agt_legacy', 'Legacy role'),
    ];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(result.current.workspaceRows.find((row) => row.id === 'agt_codex')).toMatchObject({
      subtitle: 'Codex',
      title: 'Coco',
    });
    expect(result.current.workspaceRows.find((row) => row.id === 'agt_legacy')?.subtitle).toBe(
      undefined,
    );
  });

  it('excludes chat groups so only agent ids reach the home input', () => {
    mocks.homeState.ungroupedAgents = [
      agent('agt_a', 'Agent'),
      { id: 'grp_chat', title: 'Chat Group', type: 'group' },
    ];

    const { result } = renderHook(() => useHomeAgentRows());

    expect(ids(result.current.workspaceRows)).toEqual(['agt_inbox', 'agt_a']);
  });
});
