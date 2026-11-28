import type { SidebarAgentItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiscoverStore } from '@/store/discover';
import { useHomeStore } from '@/store/home';
import { useToolStore } from '@/store/tool';

import { useMentionCategories } from './useMentionCategories';

const state = vi.hoisted(() => ({
  currentAgentId: 'agent-current',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: false }),
}));

vi.mock('../hooks/useAgentId', () => ({
  useAgentId: () => state.currentAgentId,
}));

// Context store: no group-chat mentionItems, i.e. the agent picker path.
vi.mock('../store', () => ({
  useChatInputStore: <T>(selector: (s: { mentionItems?: unknown }) => T) =>
    selector({ mentionItems: undefined }),
}));

vi.mock('./ActionTag/useInstalledSkillsAndTools', () => ({
  useInstalledSkillsAndTools: () => [],
}));

// More agents than the menu previews at once; every one must stay a mention
// candidate so Fuse search can still reach the ones the preview never shows.
const AGENT_COUNT = 30;

const makeAgent = (id: string, overrides: Partial<SidebarAgentItem> = {}): SidebarAgentItem => ({
  id,
  pinned: false,
  title: `Agent ${id}`,
  type: 'agent',
  ...overrides,
});

const seedHomeStore = (lists: {
  agentGroups?: { id: string; items: SidebarAgentItem[] }[];
  pinnedAgents?: SidebarAgentItem[];
  privateAgentGroups?: { id: string; items: SidebarAgentItem[] }[];
  privatePinnedAgents?: SidebarAgentItem[];
  privateUngroupedAgents?: SidebarAgentItem[];
  ungroupedAgents?: SidebarAgentItem[];
}) => {
  useHomeStore.setState({
    agentGroups: [],
    pinnedAgents: [],
    privateAgentGroups: [],
    privatePinnedAgents: [],
    privateUngroupedAgents: [],
    ungroupedAgents: [],
    ...lists,
  } as never);
};

const agentIdsInCategory = (categoryId: string) => {
  const { result } = renderHook(() => useMentionCategories());
  const category = result.current.categories.find((c) => c.id === categoryId);
  return new Set(category?.items.map((item) => item.metadata?.id as string) ?? []);
};

beforeEach(() => {
  state.currentAgentId = 'agent-current';

  // Market fetch hooks are store methods; stub them so the hook runs without
  // network. Permission is denied anyway, so no market rows would merge.
  const disabledListFetch = () => ({ queryKey: undefined });
  useDiscoverStore.setState({
    useFetchAssistantList: disabledListFetch,
    useFetchSkillList: disabledListFetch,
  } as never);
  const fetchAgentSkillsStub = () => ({});
  useToolStore.setState({ useFetchAgentSkills: fetchAgentSkillsStub } as never);
});

describe('useMentionCategories', () => {
  it('offers every eligible agent as a mention candidate, not just the previewed ones', () => {
    const pinned = [makeAgent('agent-pinned-1'), makeAgent('agent-pinned-2')];
    const ungrouped = [makeAgent('agent-current')].concat(
      Array.from({ length: AGENT_COUNT - pinned.length - 1 }, (_, i) =>
        makeAgent(`agent-${String(i + 1).padStart(3, '0')}`),
      ),
    );
    const oldest = ungrouped.at(-1);

    seedHomeStore({ pinnedAgents: pinned, ungroupedAgents: ungrouped });

    const ids = agentIdsInCategory('agent');
    const expected = new Set([...pinned, ...ungrouped].map((a) => a.id));
    expected.delete('agent-current');

    expect(ids).toEqual(expected);
    expect(ids.has(oldest.id)).toBe(true);
  });

  describe('private agents', () => {
    const PRIVATE_COUNT = 12;

    it('offers every private agent when the current agent is itself private', () => {
      const privateAgents = [makeAgent('agent-current')].concat(
        Array.from({ length: PRIVATE_COUNT - 1 }, (_, i) => makeAgent(`agent-private-${i}`)),
      );
      seedHomeStore({
        privateUngroupedAgents: privateAgents,
        ungroupedAgents: [makeAgent('agent-workspace-1')],
      });

      const ids = agentIdsInCategory('agent-private');
      expect(ids.size).toBe(PRIVATE_COUNT - 1);
      for (const agent of privateAgents.slice(1)) {
        expect(ids.has(agent.id)).toBe(true);
      }
    });

    it('hides private agents when the current agent is shared', () => {
      seedHomeStore({
        privateUngroupedAgents: Array.from({ length: PRIVATE_COUNT }, (_, i) =>
          makeAgent(`agent-private-${i}`),
        ),
        ungroupedAgents: [makeAgent('agent-current'), makeAgent('agent-workspace-1')],
      });

      const { result } = renderHook(() => useMentionCategories());
      expect(result.current.categories.some((c) => c.id === 'agent-private')).toBe(false);
    });
  });
});
