import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTokenBreakdown } from './useTokenBreakdown';

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
  summaries: {} as Record<string, string>,
}));

// One token per character, so a count names the text it was taken from.
vi.mock('@/hooks/useTokenCount', () => ({ useTokenCount: (text = '') => text.length }));
vi.mock('@/hooks/useModelContextWindowTokens', () => ({ useModelContextWindowTokens: () => 8000 }));
vi.mock('@/hooks/useModelSupportToolUse', () => ({ useModelSupportToolUse: () => false }));
vi.mock('@/helpers/toolEngineering', () => ({
  createAgentToolsEngine: () => ({
    generateToolsDetailed: () => ({ enabledManifests: [], tools: [] }),
  }),
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));
// `useEffectiveModel` owns loading the composer topic by id (see `useTopicModel`);
// here the topic lands in `topicDetailMap` the way that fetch would put it.
vi.mock('../../hooks/useEffectiveModel', () => ({
  useEffectiveModel: () => ({ model: 'model-1', provider: 'provider-1' }),
}));

vi.mock('../../store', () => ({
  useChatInputStore: (selector: (s: object) => unknown) =>
    selector({ topicId: state.composerTopicId }),
  useStoreApi: () => ({
    getState: () => ({ contextWindowMessages: [], markdownContent: '' }),
    subscribe: () => () => {},
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) => selector({ activeAgentId: 'agent-1' }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentKnowledgeBasesById: () => () => [],
    getAgentPluginsById: () => () => [],
    getAgentSystemRoleById: () => () => '',
  },
  chatConfigByIdSelectors: {
    getChatConfigById: () => () => ({}),
    getRuntimeModeById: () => () => undefined,
    getSkillActivateModeById: () => () => undefined,
  },
}));
vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock('@/store/aiInfra/selectors', () => ({
  aiModelSelectors: {
    isModelBuiltinSearchInternal: () => () => false,
    isModelHasBuiltinSearch: () => () => false,
  },
  aiProviderSelectors: { isProviderHasBuiltinSearch: () => () => false },
}));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (s: object) => unknown) => selector({ installedPlugins: [] }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({ settingsSelectors: { memoryEnabled: () => false } }));

// Store boundary: the real topic selectors run against this state.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      activeTopicId: state.activeTopicId,
      topicDataMap: {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.summaries).map(([id, historySummary]) => [id, { historySummary, id }]),
      ),
    }),
}));

beforeEach(() => {
  // The main column's topic stays globally active while another composer renders its own.
  state.activeTopicId = 'main-topic';
  state.composerTopicId = undefined;
  state.summaries = { 'main-topic': 'main column summary', 'pane-topic': 'pane' };
});

describe('useTokenBreakdown', () => {
  it("counts the composer's own topic summary rather than the global active topic's", () => {
    state.composerTopicId = 'pane-topic';

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe('pane'.length);
  });

  it('counts no summary when the composer conversation has no topic, even with an active topic', () => {
    state.composerTopicId = null;

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe(0);
  });

  it('follows the global active topic when the host publishes no topic', () => {
    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe('main column summary'.length);
  });

  // A document's chat panel runs on a `trigger='document'` system topic that
  // never reaches the loaded lists, yet the run includes its persisted summary.
  it('counts an unlisted composer topic summary once its detail arrives', () => {
    state.composerTopicId = 'doc-topic';

    const { rerender, result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe(0);

    state.summaries['doc-topic'] = 'doc summary';
    rerender();

    expect(result.current.historySummaryToken).toBe('doc summary'.length);
  });

  // `/goal/:goalId` makes a sidebar-excluded supervision topic globally active
  // with no `useFetchActiveTopicDetail` mounted.
  it('counts the global active topic summary once its detail arrives', () => {
    state.composerTopicId = 'main-topic';
    delete state.summaries['main-topic'];

    const { rerender, result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe(0);

    state.summaries['main-topic'] = 'goal summary';
    rerender();

    expect(result.current.historySummaryToken).toBe('goal summary'.length);
  });
});
