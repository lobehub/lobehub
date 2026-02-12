import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_SEARCH_FC_MODEL } from '@lobechat/const';
import { describe, expect, it, vi } from 'vitest';

import { type AgentStoreState } from '@/store/agent/initialState';
import { initialAgentSliceState } from '@/store/agent/slices/agent/initialState';
import { initialBuiltinAgentSliceState } from '@/store/agent/slices/builtin/initialState';

import { agentChatConfigSelectors } from './chatConfigSelectors';

// Mock model runtime functions
vi.mock('@lobechat/model-runtime', () => ({
  isContextCachingModel: vi.fn((model) => model === 'claude-3-5-sonnet'),
  isThinkingWithToolClaudeModel: vi.fn((model) => model === 'claude-3-7-sonnet'),
}));

const createState = (overrides: Partial<AgentStoreState> = {}): AgentStoreState => ({
  ...initialAgentSliceState,
  ...initialBuiltinAgentSliceState,
  ...overrides,
});

describe('agentChatConfigSelectors', () => {
  describe('currentChatConfig', () => {
    it('should return chatConfig from current agent merged with defaults', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { historyCount: 10 },
          },
        },
      });

      expect(agentChatConfigSelectors.currentChatConfig(state)).toMatchObject({ historyCount: 10 });
    });

    it('should return empty chatConfig when no chatConfig specified', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: { 'agent-1': {} },
      });

      // Returns empty object when no chatConfig exists
      // Individual selectors apply defaults via ?? operator
      expect(agentChatConfigSelectors.currentChatConfig(state)).toEqual({});
    });
  });

  describe('agentSearchMode', () => {
    it('should return searchMode from config', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { searchMode: 'auto' },
          } as any,
        },
      });

      expect(agentChatConfigSelectors.agentSearchMode(state)).toBe('auto');
    });

    it('should return "off" as default', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: { 'agent-1': {} },
      });

      expect(agentChatConfigSelectors.agentSearchMode(state)).toBe('off');
    });
  });

  describe('isAgentEnableSearch', () => {
    it('should return true when searchMode is not "off"', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { searchMode: 'auto' },
          } as any,
        },
      });

      expect(agentChatConfigSelectors.isAgentEnableSearch(state)).toBe(true);
    });

    it('should return false when searchMode is "off"', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { searchMode: 'off' },
          } as any,
        },
      });

      expect(agentChatConfigSelectors.isAgentEnableSearch(state)).toBe(false);
    });
  });

  describe('useModelBuiltinSearch', () => {
    it('should return useModelBuiltinSearch value', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { useModelBuiltinSearch: true },
          },
        },
      });

      expect(agentChatConfigSelectors.useModelBuiltinSearch(state)).toBe(true);
    });
  });

  describe('searchFCModel', () => {
    it('should return searchFCModel from config when explicitly set', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { searchFCModel: { model: 'custom-model', provider: 'openai' } },
          } as any,
        },
      });

      expect(agentChatConfigSelectors.searchFCModel(state)).toMatchObject({
        model: 'custom-model',
        provider: 'openai',
      });
    });

    it('should return default when not specified', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: { 'agent-1': {} },
      });

      expect(agentChatConfigSelectors.searchFCModel(state)).toStrictEqual(
        DEFAULT_AGENT_SEARCH_FC_MODEL,
      );
    });
  });

  describe('enableHistoryCount', () => {
    it('should return false when context caching enabled and model supports it', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { disableContextCaching: false, enableHistoryCount: true },
            model: 'claude-3-5-sonnet',
          },
        },
      });

      expect(agentChatConfigSelectors.enableHistoryCount(state)).toBe(false);
    });

    it('should return false when search enabled and model is claude-3-7-sonnet', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: {
              disableContextCaching: true,
              enableHistoryCount: true,
              searchMode: 'auto',
            },
            model: 'claude-3-7-sonnet',
          } as any,
        },
      });

      expect(agentChatConfigSelectors.enableHistoryCount(state)).toBe(false);
    });

    it('should return enableHistoryCount value when no special cases apply', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: {
              disableContextCaching: true,
              enableHistoryCount: true,
              searchMode: 'off',
            },
            model: 'gpt-4',
          },
        },
      });

      expect(agentChatConfigSelectors.enableHistoryCount(state)).toBe(true);
    });
  });

  describe('historyCount', () => {
    it('should return historyCount from config', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { historyCount: 5 },
          },
        },
      });

      expect(agentChatConfigSelectors.historyCount(state)).toBe(5);
    });

    it('should return 0 when historyCount is 0', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: { historyCount: 0 },
          },
        },
      });

      expect(agentChatConfigSelectors.historyCount(state)).toBe(0);
    });

    it('should return default when not specified', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: { 'agent-1': {} },
      });

      expect(agentChatConfigSelectors.historyCount(state)).toBe(
        DEFAULT_AGENT_CHAT_CONFIG.historyCount,
      );
    });
  });

  describe('enableHistoryDivider', () => {
    it('should return true when conditions are met', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: {
              disableContextCaching: true,
              enableHistoryCount: true,
              historyCount: 3,
            },
            model: 'gpt-4',
          },
        },
      });

      // historyLength = 5, currentIndex = 2 => historyLength - currentIndex = 3 = historyCount
      expect(agentChatConfigSelectors.enableHistoryDivider(5, 2)(state)).toBe(true);
    });

    it('should return false when enableHistoryCount is false', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: {
              enableHistoryCount: false,
              historyCount: 3,
            },
          },
        },
      });

      expect(agentChatConfigSelectors.enableHistoryDivider(5, 2)(state)).toBe(false);
    });

    it('should return false when historyLength <= historyCount', () => {
      const state = createState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': {
            chatConfig: {
              disableContextCaching: true,
              enableHistoryCount: true,
              historyCount: 10,
            },
            model: 'gpt-4',
          },
        },
      });

      // historyLength = 5 <= historyCount = 10
      expect(agentChatConfigSelectors.enableHistoryDivider(5, 2)(state)).toBe(false);
    });
  });
});
