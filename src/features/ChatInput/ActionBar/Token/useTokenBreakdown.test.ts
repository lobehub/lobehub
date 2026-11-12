// cspell:ignore tokenx
import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { estimateTokenCount } from 'tokenx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextWindow } from '../../store/initialState';
import { useTokenBreakdown } from './useTokenBreakdown';

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
  contextWindow: undefined as ContextWindow | undefined,
  input: '',
  listeners: new Set<() => void>(),
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
    getState: () => ({ contextWindow: state.contextWindow, markdownContent: state.input }),
    subscribe: (listener: () => void) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
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
  state.contextWindow = undefined;
  state.input = '';
  state.listeners.clear();
  state.summaries = { 'main-topic': 'main column summary', 'pane-topic': 'pane' };
});

afterEach(() => {
  vi.useRealTimers();
});

/** Publish a composer store change and let the 300ms debounced reader pick it up. */
const publishComposer = (next: Partial<Pick<typeof state, 'contextWindow' | 'input'>>) => {
  Object.assign(state, next);
  act(() => {
    for (const listener of state.listeners) listener();
    vi.advanceTimersByTime(300);
  });
};

const recordedAccounting = {
  bySource: {
    content: 1000,
    fileContext: 300,
    reasoning: 40,
    thoughtSignature: 5,
    toolCallId: 6,
    toolCalls: 70,
    toolDefinition: 4000,
  },
  estimator: 'tokenx' as const,
  messageCount: 5,
  system: 2000,
  total: 7421,
};

const message = (m: Partial<UIChatMessage> & Pick<UIChatMessage, 'id' | 'role'>) =>
  ({ content: '', createdAt: 0, updatedAt: 0, ...m }) as UIChatMessage;

describe('useTokenBreakdown', () => {
  it("counts the composer's own topic summary rather than the global active topic's", () => {
    state.composerTopicId = 'pane-topic';

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.systemToken).toBe('pane'.length);
  });

  it('counts no summary when the composer conversation has no topic, even with an active topic', () => {
    state.composerTopicId = null;

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.systemToken).toBe(0);
  });

  it('follows the global active topic when the host publishes no topic', () => {
    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.systemToken).toBe('main column summary'.length);
  });

  // A document's chat panel runs on a `trigger='document'` system topic that
  // never reaches the loaded lists, yet the run includes its persisted summary.
  it('counts an unlisted composer topic summary once its detail arrives', () => {
    state.composerTopicId = 'doc-topic';

    const { rerender, result } = renderHook(() => useTokenBreakdown());

    expect(result.current.systemToken).toBe(0);

    state.summaries['doc-topic'] = 'doc summary';
    rerender();

    expect(result.current.systemToken).toBe('doc summary'.length);
  });

  // `/goal/:goalId` makes a sidebar-excluded supervision topic globally active
  // with no `useFetchActiveTopicDetail` mounted.
  it('counts the global active topic summary once its detail arrives', () => {
    state.composerTopicId = 'main-topic';
    delete state.summaries['main-topic'];

    const { rerender, result } = renderHook(() => useTokenBreakdown());

    expect(result.current.systemToken).toBe(0);

    state.summaries['main-topic'] = 'goal summary';
    rerender();

    expect(result.current.systemToken).toBe('goal summary'.length);
  });

  it('counts tool calls, tool results and attachments of the conversation, not only text', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTokenBreakdown());

    const userTurn = message({
      content: 'read the report',
      fileList: [
        {
          content: 'quarterly revenue grew 12% '.repeat(40),
          fileType: 'text/plain',
          id: 'file_1',
          name: 'report.txt',
          size: 1024,
          url: 'https://example.com/report.txt',
        },
      ],
      id: 'u1',
      role: 'user',
    });
    const toolCall = message({
      id: 'a1',
      role: 'assistant',
      tools: [
        {
          apiName: 'readFile',
          arguments: '{"path":"/tmp/report.txt"}',
          id: 'call_1',
          identifier: 'local-system',
          type: 'builtin',
        },
      ],
    });
    publishComposer({ contextWindow: { history: [userTurn, toolCall] } });

    const before = result.current;
    expect(before.chatsToken).toBe(estimateTokenCount('read the report'));
    expect(before.fileContextToken).toBeGreaterThan(100);
    expect(before.toolCallsToken).toBeGreaterThan(0);

    // ROOT CAUSE: the breakdown only summed string `content`, so a tool result
    // the next request carries never moved the "Chat Messages" row.
    const toolResult = 'line of the file\n'.repeat(300);
    publishComposer({
      contextWindow: {
        history: [
          userTurn,
          toolCall,
          message({ content: toolResult, id: 't1', role: 'tool', tool_call_id: 'call_1' }),
        ],
      },
    });

    expect(result.current.chatsToken - before.chatsToken).toBe(
      estimateTokenCount(toolResult) + estimateTokenCount('call_1'),
    );
    expect(result.current.totalToken).toBeGreaterThan(before.totalToken);
  });

  it('takes system and tools from the recorded request and adds what came after it', () => {
    vi.useFakeTimers();
    state.composerTopicId = 'pane-topic';
    const { result } = renderHook(() => useTokenBreakdown());

    const reply = 'Here is the summary.';
    publishComposer({
      contextWindow: {
        history: [],
        request: {
          accounting: recordedAccounting,
          inputTokens: 9000,
          messages: [
            message({
              content: reply,
              id: 'a1',
              reasoning: { content: 'thinking it over' },
              role: 'assistant',
              // Recorded provider usage must not replace the per-field estimate.
              usage: { totalInputTokens: 9000, totalOutputTokens: 999 },
            }),
          ],
          model: 'model-1',
          provider: 'provider-1',
        },
      },
      input: 'next question',
    });

    expect(result.current).toMatchObject({
      chatsToken: 1000 + 6 + estimateTokenCount(reply) + 'next question'.length,
      fileContextToken: 300,
      lastRequestInputTokens: 9000,
      reasoningToken: 40 + estimateTokenCount('thinking it over'),
      // The recorded system message already carries the pane topic's summary.
      systemToken: 2000,
      toolCallsToken: 75,
      toolsToken: 4000,
    });
    expect(result.current.totalToken).toBe(
      result.current.systemToken +
        result.current.toolsToken +
        result.current.chatsToken +
        result.current.fileContextToken +
        result.current.toolCallsToken +
        result.current.reasoningToken,
    );
  });

  it('estimates from the history window again after the composer switches model', () => {
    vi.useFakeTimers();
    state.composerTopicId = 'pane-topic';
    const { result } = renderHook(() => useTokenBreakdown());

    publishComposer({
      contextWindow: {
        history: [message({ content: 'hello there', id: 'u1', role: 'user' })],
        // Recorded for another model: its tools and system prompt no longer apply.
        request: { accounting: recordedAccounting, messages: [], model: 'other-model' },
      },
    });

    expect(result.current).toMatchObject({
      chatsToken: estimateTokenCount('hello there'),
      // The live estimate: system role (empty) + the pane topic's summary.
      systemToken: 'pane'.length,
      toolsToken: 0,
    });
  });
});
