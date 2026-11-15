import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeAssistantListParams } from '@/store/discover/slices/assistant/action';
import { assistantListQueryKey } from '@/store/discover/slices/assistant/projection';
import { normalizeSkillListParams } from '@/store/discover/slices/skill/action';
import { skillListQueryKey } from '@/store/discover/slices/skill/projection';
import { AssistantSorts, SkillSorts } from '@/types/discover';

import { MARKET_MENTION_FETCH_SIZE } from './marketMentionItems';
import { useMentionCategories, useMentionSourceSync } from './useMentionCategories';

const mocks = vi.hoisted(() => ({
  canInstall: true,
  globalStore: undefined as undefined | { getState: () => unknown; setState: (s: object) => void },
  discoverState: {
    assistantListMap: {} as Record<string, unknown>,
    skillListMap: {} as Record<string, unknown>,
    useFetchAssistantList: vi.fn(() => ({})),
    useFetchSkillList: vi.fn(() => ({})),
  },
  useFetchAgentSkills: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canInstall }),
}));
vi.mock('@/store/discover', () => ({
  useDiscoverStore: (selector: (s: typeof mocks.discoverState) => unknown) =>
    selector(mocks.discoverState),
}));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (s: object) => unknown) =>
    selector({ useFetchAgentSkills: mocks.useFetchAgentSkills }),
}));
vi.mock('@/store/home', () => ({ useHomeStore: () => [] }));
vi.mock('@/store/global', async () => {
  const { create } = await import('zustand');
  // A real store, so a language switch reaches subscribers without a rerender.
  const useGlobalStore = create(() => ({ language: 'en-US' }));
  mocks.globalStore = useGlobalStore;
  return { useGlobalStore };
});
vi.mock('@/store/global/selectors', () => ({
  globalGeneralSelectors: { currentLanguage: (s: { language: string }) => s.language },
  systemStatusSelectors: { topicPageSize: () => 20 },
}));
vi.mock('@/store/global/helpers', () => ({
  globalHelpers: {
    getCurrentLanguage: () =>
      (mocks.globalStore?.getState() as { language: string } | undefined)?.language ?? 'en-US',
  },
}));
vi.mock('@/store/chat', () => ({ useChatStore: () => [] }));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { displayTopicsForSidebar: () => () => [] },
}));
vi.mock('../hooks/useAgentId', () => ({ useAgentId: () => 'agt_1' }));
vi.mock('../store', () => ({
  useChatInputStore: (selector: (s: { mentionItems?: unknown }) => unknown) => selector({}),
}));
vi.mock('./ActionTag/useInstalledSkillsAndTools', () => ({
  useInstalledSkillsAndTools: () => [],
}));

const agentKey = assistantListQueryKey(
  normalizeAssistantListParams({
    page: 1,
    pageSize: MARKET_MENTION_FETCH_SIZE,
    sort: AssistantSorts.Recommended,
  }),
);
const skillKey = skillListQueryKey(
  normalizeSkillListParams({
    page: 1,
    pageSize: MARKET_MENTION_FETCH_SIZE,
    sort: SkillSorts.InstallCount,
  }),
);

describe('mention sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canInstall = true;
    mocks.globalStore?.setState({ language: 'en-US' });
    mocks.discoverState.assistantListMap = {
      [agentKey]: { items: [{ identifier: 'market-agent', title: 'Market Agent' }] },
    };
    mocks.discoverState.skillListMap = {
      [skillKey]: { items: [{ identifier: 'market-skill', name: 'Market Skill' }] },
    };
  });

  it('reads market rows without subscribing the editor to the syncs', () => {
    // Regression: the sync hooks re-rendered the whole editor on every
    // fetch-lifecycle flip while the conversation first opened.
    const { result } = renderHook(() => useMentionCategories());

    expect(mocks.useFetchAgentSkills).not.toHaveBeenCalled();
    expect(mocks.discoverState.useFetchAssistantList).not.toHaveBeenCalled();
    expect(mocks.discoverState.useFetchSkillList).not.toHaveBeenCalled();

    const keys = result.current.categories.flatMap((c) => c.items.map((item) => item.key));
    expect(keys.some((key) => String(key).includes('market-agent'))).toBe(true);
    expect(keys.some((key) => String(key).includes('market-skill'))).toBe(true);
  });

  it('starts the installed-skill and market syncs from the sync hook', () => {
    renderHook(() => useMentionSourceSync());

    expect(mocks.useFetchAgentSkills).toHaveBeenCalledWith(true);
    expect(mocks.discoverState.useFetchAssistantList).toHaveBeenCalledWith(
      { page: 1, pageSize: MARKET_MENTION_FETCH_SIZE, sort: AssistantSorts.Recommended },
      { enabled: true },
    );
    expect(mocks.discoverState.useFetchSkillList).toHaveBeenCalledWith(
      { page: 1, pageSize: MARKET_MENTION_FETCH_SIZE, sort: SkillSorts.InstallCount },
      { enabled: true },
    );
  });

  it('keeps market syncs off without install permission', () => {
    mocks.canInstall = false;

    renderHook(() => useMentionSourceSync());

    expect(mocks.discoverState.useFetchAssistantList).toHaveBeenCalledWith(expect.anything(), {
      enabled: false,
    });
    expect(mocks.discoverState.useFetchSkillList).toHaveBeenCalledWith(expect.anything(), {
      enabled: false,
    });
  });
});

describe('useMentionSourceSync language', () => {
  it('re-syncs the market lists when the UI language changes', () => {
    // Regression: the sync leaf has no props and no language subscription of
    // its own, so a language switch kept syncing the old language's lists.
    const languages: string[] = [];
    mocks.discoverState.useFetchAssistantList.mockImplementation(() => {
      languages.push((mocks.globalStore!.getState() as { language: string }).language);
      return {};
    });
    renderHook(() => useMentionSourceSync());

    act(() => mocks.globalStore!.setState({ language: 'zh-CN' }));

    expect(languages.at(-1)).toBe('zh-CN');
  });
});
