import { type LobeAgentChatConfig } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFollowUpActionStore } from '@/store/followUpAction';
import { useUserStore } from '@/store/user';

import { useChatFollowUp } from './useChatFollowUp';

const VALID_GLOBAL = {
  enabled: true,
  model: 'global-model',
  provider: 'global-provider',
};

const VALID_AGENT: LobeAgentChatConfig = {
  enableFollowUpChips: true,
} as LobeAgentChatConfig;

const CONVERSATION_KEY = 'main_agent-1_topic-1';
const TOPIC_ID = 'topic-1';

type Mock = ReturnType<typeof vi.fn>;

vi.mock('@/store/user', () => ({
  useUserStore: vi.fn(),
}));

const desktop = vi.hoisted(() => ({ isDesktop: false }));
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get isDesktop() {
    return desktop.isDesktop;
  },
}));

const agentType = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentConfigById: () => () => ({
      agencyConfig: { heterogeneousProvider: { type: agentType.value } },
    }),
  },
}));

describe('useChatFollowUp', () => {
  let fetchFor: ReturnType<typeof vi.fn>;
  let clear: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFor = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();

    vi.spyOn(useFollowUpActionStore, 'getState').mockReturnValue({
      fetchFor,
      clear,
    } as any);

    (useUserStore as unknown as Mock).mockImplementation((selector: any) =>
      selector({
        settings: { systemAgent: { followUpAction: VALID_GLOBAL } },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (useUserStore as unknown as Mock).mockReset();
  });

  describe('Claude Code native suggestions', () => {
    const renderNative = () =>
      renderHook(() =>
        useChatFollowUp({
          agentChatConfig: VALID_AGENT,
          agentId: 'agent-1',
          conversationKey: CONVERSATION_KEY,
          topicId: TOPIC_ID,
        }),
      ).result.current;

    afterEach(() => {
      desktop.isDesktop = false;
      agentType.value = undefined;
    });

    it('skips extraction on desktop and still clears on send', async () => {
      desktop.isDesktop = true;
      agentType.value = 'claude-code';
      (useUserStore as unknown as Mock).mockImplementation((selector: any) =>
        selector({ settings: { systemAgent: { followUpAction: { enabled: false } } } }),
      );

      const hooks = renderNative();

      expect(hooks.onAssistantTurnSettled).toBeUndefined();
      await hooks.onBeforeSendMessage?.({} as any);
      expect(clear).toHaveBeenCalledWith(CONVERSATION_KEY);
    });

    it('keeps server extraction for Claude Code on the web', () => {
      agentType.value = 'claude-code';
      expect(renderNative().onAssistantTurnSettled).toBeDefined();
    });

    it('keeps server extraction for other CLI agents on desktop', () => {
      desktop.isDesktop = true;
      agentType.value = 'codex';
      expect(renderNative().onAssistantTurnSettled).toBeDefined();
    });
  });

  describe('disabled effective state — returns empty hooks', () => {
    const renderWith = (config: {
      agentChatConfig?: LobeAgentChatConfig;
      conversationKey?: string;
      topicId?: string;
    }) =>
      renderHook(() =>
        useChatFollowUp({
          agentChatConfig: config.agentChatConfig,
          conversationKey: config.conversationKey,
          topicId: config.topicId,
        }),
      );

    const assertEmpty = (hooks: ReturnType<typeof useChatFollowUp>) => {
      expect(hooks.onBeforeSendMessage).toBeUndefined();
      expect(hooks.onBeforeContinue).toBeUndefined();
      expect(hooks.onBeforeRegenerate).toBeUndefined();
      expect(hooks.onAssistantTurnSettled).toBeUndefined();
    };

    it('when global enabled = false', () => {
      (useUserStore as unknown as Mock).mockImplementation((selector: any) =>
        selector({
          settings: {
            systemAgent: { followUpAction: { ...VALID_GLOBAL, enabled: false } },
          },
        }),
      );
      const { result } = renderWith({
        agentChatConfig: VALID_AGENT,
        conversationKey: CONVERSATION_KEY,
        topicId: TOPIC_ID,
      });
      assertEmpty(result.current);
    });

    it('when global model is empty', () => {
      (useUserStore as unknown as Mock).mockImplementation((selector: any) =>
        selector({
          settings: {
            systemAgent: { followUpAction: { ...VALID_GLOBAL, model: '' } },
          },
        }),
      );
      const { result } = renderWith({
        agentChatConfig: VALID_AGENT,
        conversationKey: CONVERSATION_KEY,
        topicId: TOPIC_ID,
      });
      assertEmpty(result.current);
    });

    it('when global provider is empty', () => {
      (useUserStore as unknown as Mock).mockImplementation((selector: any) =>
        selector({
          settings: {
            systemAgent: { followUpAction: { ...VALID_GLOBAL, provider: '' } },
          },
        }),
      );
      const { result } = renderWith({
        agentChatConfig: VALID_AGENT,
        conversationKey: CONVERSATION_KEY,
        topicId: TOPIC_ID,
      });
      assertEmpty(result.current);
    });

    it('when per-agent enableFollowUpChips is false', () => {
      const { result } = renderWith({
        agentChatConfig: { enableFollowUpChips: false } as LobeAgentChatConfig,
        conversationKey: CONVERSATION_KEY,
        topicId: TOPIC_ID,
      });
      assertEmpty(result.current);
    });

    it('when conversationKey is missing', () => {
      const { result } = renderWith({
        agentChatConfig: VALID_AGENT,
        conversationKey: undefined,
        topicId: TOPIC_ID,
      });
      assertEmpty(result.current);
    });

    it('when topicId is missing', () => {
      const { result } = renderWith({
        agentChatConfig: VALID_AGENT,
        conversationKey: CONVERSATION_KEY,
        topicId: undefined,
      });
      assertEmpty(result.current);
    });

    it('does not call clear or fetchFor when invoked through empty hooks', async () => {
      const { result } = renderWith({
        agentChatConfig: { enableFollowUpChips: false } as LobeAgentChatConfig,
        conversationKey: CONVERSATION_KEY,
        topicId: TOPIC_ID,
      });
      await result.current.onBeforeSendMessage?.({} as any);
      await result.current.onAssistantTurnSettled?.('m', { reason: 'completed' });
      expect(clear).not.toHaveBeenCalled();
      expect(fetchFor).not.toHaveBeenCalled();
    });
  });

  describe('enabled effective state', () => {
    const renderEnabled = (overrides: Partial<Parameters<typeof useChatFollowUp>[0]> = {}) =>
      renderHook(() =>
        useChatFollowUp({
          agentChatConfig: VALID_AGENT,
          conversationKey: CONVERSATION_KEY,
          topicId: TOPIC_ID,
          ...overrides,
        }),
      );

    it('onBeforeSendMessage clears the slot', async () => {
      const { result } = renderEnabled();
      await result.current.onBeforeSendMessage?.({} as any);
      expect(clear).toHaveBeenCalledWith(CONVERSATION_KEY);
    });

    it('onBeforeContinue clears the slot', async () => {
      const { result } = renderEnabled();
      await result.current.onBeforeContinue?.('m');
      expect(clear).toHaveBeenCalledWith(CONVERSATION_KEY);
    });

    it('onBeforeRegenerate clears the slot', async () => {
      const { result } = renderEnabled();
      await result.current.onBeforeRegenerate?.('m');
      expect(clear).toHaveBeenCalledWith(CONVERSATION_KEY);
    });

    it('onAssistantTurnSettled with reason=stopped skips fetch', async () => {
      const { result } = renderEnabled();
      await result.current.onAssistantTurnSettled?.('m', { reason: 'stopped' });
      expect(fetchFor).not.toHaveBeenCalled();
    });

    it('onAssistantTurnSettled with reason=completed fires fetchFor with full params', async () => {
      const { result } = renderEnabled({ threadId: 'thread-1' });
      await result.current.onAssistantTurnSettled?.('m', { reason: 'completed' });
      expect(fetchFor).toHaveBeenCalledWith(CONVERSATION_KEY, {
        hint: { kind: 'chat' },
        modelConfig: { model: VALID_GLOBAL.model, provider: VALID_GLOBAL.provider },
        threadId: 'thread-1',
        topicId: TOPIC_ID,
      });
    });

    it('onAssistantTurnSettled with reason=regenerated fires fetchFor', async () => {
      const { result } = renderEnabled();
      await result.current.onAssistantTurnSettled?.('m', { reason: 'regenerated' });
      expect(fetchFor).toHaveBeenCalledTimes(1);
    });

    it('onAssistantTurnSettled with reason=continued fires fetchFor', async () => {
      const { result } = renderEnabled();
      await result.current.onAssistantTurnSettled?.('m', { reason: 'continued' });
      expect(fetchFor).toHaveBeenCalledTimes(1);
    });

    it('clear is scoped to the passed conversationKey — different keys do not collide', async () => {
      const { result: a } = renderEnabled({ conversationKey: 'key-a' });
      const { result: b } = renderEnabled({ conversationKey: 'key-b' });

      await a.current.onBeforeSendMessage?.({} as any);
      expect(clear).toHaveBeenCalledWith('key-a');
      expect(clear).not.toHaveBeenCalledWith('key-b');

      await b.current.onBeforeSendMessage?.({} as any);
      expect(clear).toHaveBeenCalledWith('key-b');
    });
  });
});
