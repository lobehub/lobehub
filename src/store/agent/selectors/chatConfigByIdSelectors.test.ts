import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_SEARCH_FC_MODEL } from '@lobechat/const';
import { describe, expect, it, vi } from 'vitest';

import { type AgentStoreState } from '@/store/agent/initialState';
import { initialAgentSliceState } from '@/store/agent/slices/agent/initialState';
import { initialBuiltinAgentSliceState } from '@/store/agent/slices/builtin/initialState';

import { chatConfigByIdSelectors } from './chatConfigByIdSelectors';

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

describe('chatConfigByIdSelectors', () => {
  describe('getChatConfigById', () => {
    it('should return chatConfig for specified agent', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { historyCount: 10 } },
          'agent-2': { chatConfig: { historyCount: 20 } },
        },
      });

      expect(chatConfigByIdSelectors.getChatConfigById('agent-1')(state)).toMatchObject({
        historyCount: 10,
      });
      expect(chatConfigByIdSelectors.getChatConfigById('agent-2')(state)).toMatchObject({
        historyCount: 20,
      });
    });

    it('should return empty chatConfig when agent has no chatConfig', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      // Returns empty object when no chatConfig exists
      // Individual selectors (like getHistoryCountById) apply defaults via ?? operator
      expect(chatConfigByIdSelectors.getChatConfigById('agent-1')(state)).toEqual({});
    });

    it('should return empty chatConfig for non-existent agent', () => {
      const state = createState({
        agentMap: {},
      });

      // Returns empty object for non-existent agent
      // Individual selectors (like getHistoryCountById) apply defaults via ?? operator
      expect(chatConfigByIdSelectors.getChatConfigById('non-existent')(state)).toEqual({});
    });
  });

  describe('getEnableHistoryCountById', () => {
    it('should return false when context caching enabled and model supports it', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { disableContextCaching: false, enableHistoryCount: true },
            model: 'claude-3-5-sonnet',
          },
        },
      });

      expect(chatConfigByIdSelectors.getEnableHistoryCountById('agent-1')(state)).toBe(false);
    });

    it('should return false when search enabled and model is claude-3-7-sonnet', () => {
      const state = createState({
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

      expect(chatConfigByIdSelectors.getEnableHistoryCountById('agent-1')(state)).toBe(false);
    });

    it('should return enableHistoryCount value when no special cases apply', () => {
      const state = createState({
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

      expect(chatConfigByIdSelectors.getEnableHistoryCountById('agent-1')(state)).toBe(true);
    });

    it('should work with different agents independently', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { disableContextCaching: true, enableHistoryCount: true },
            model: 'gpt-4',
          },
          'agent-2': {
            chatConfig: { disableContextCaching: false, enableHistoryCount: true },
            model: 'claude-3-5-sonnet',
          },
        },
      });

      expect(chatConfigByIdSelectors.getEnableHistoryCountById('agent-1')(state)).toBe(true);
      expect(chatConfigByIdSelectors.getEnableHistoryCountById('agent-2')(state)).toBe(false);
    });
  });

  describe('getHistoryCountById', () => {
    it('should return historyCount for specified agent', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { historyCount: 5 } },
          'agent-2': { chatConfig: { historyCount: 10 } },
        },
      });

      expect(chatConfigByIdSelectors.getHistoryCountById('agent-1')(state)).toBe(5);
      expect(chatConfigByIdSelectors.getHistoryCountById('agent-2')(state)).toBe(10);
    });

    it('should return 0 when historyCount is 0', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { historyCount: 0 } },
        },
      });

      expect(chatConfigByIdSelectors.getHistoryCountById('agent-1')(state)).toBe(0);
    });

    it('should return default when not specified', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      expect(chatConfigByIdSelectors.getHistoryCountById('agent-1')(state)).toBe(
        DEFAULT_AGENT_CHAT_CONFIG.historyCount,
      );
    });

    it('should return default for non-existent agent', () => {
      const state = createState({
        agentMap: {},
      });

      expect(chatConfigByIdSelectors.getHistoryCountById('non-existent')(state)).toBe(
        DEFAULT_AGENT_CHAT_CONFIG.historyCount,
      );
    });
  });

  describe('getSearchModeById', () => {
    it('should return searchMode from config', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { searchMode: 'auto' },
          } as any,
        },
      });

      expect(chatConfigByIdSelectors.getSearchModeById('agent-1')(state)).toBe('auto');
    });

    it('should return "auto" as default', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      expect(chatConfigByIdSelectors.getSearchModeById('agent-1')(state)).toBe('auto');
    });
  });

  describe('isEnableSearchById', () => {
    it('should return true when searchMode is not "off"', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { searchMode: 'auto' },
          } as any,
        },
      });

      expect(chatConfigByIdSelectors.isEnableSearchById('agent-1')(state)).toBe(true);
    });

    it('should return false when searchMode is "off"', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { searchMode: 'off' },
          } as any,
        },
      });

      expect(chatConfigByIdSelectors.isEnableSearchById('agent-1')(state)).toBe(false);
    });

    it('should return true when searchMode is not set (defaults to auto)', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      expect(chatConfigByIdSelectors.isEnableSearchById('agent-1')(state)).toBe(true);
    });
  });

  describe('getUseModelBuiltinSearchById', () => {
    it('should return useModelBuiltinSearch value', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { useModelBuiltinSearch: true },
          },
        },
      });

      expect(chatConfigByIdSelectors.getUseModelBuiltinSearchById('agent-1')(state)).toBe(true);
    });

    it('should return undefined when not set', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      expect(
        chatConfigByIdSelectors.getUseModelBuiltinSearchById('agent-1')(state),
      ).toBeUndefined();
    });
  });

  describe('getMemoryToolConfigById', () => {
    it('should return memory config for specified agent', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: {
              memory: { effort: 'high', enabled: true, toolPermission: 'read-write' },
            },
          },
        },
      });

      expect(chatConfigByIdSelectors.getMemoryToolConfigById('agent-1')(state)).toEqual({
        effort: 'high',
        enabled: true,
        toolPermission: 'read-write',
      });
    });

    it('should return undefined when memory config is not set', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      expect(chatConfigByIdSelectors.getMemoryToolConfigById('agent-1')(state)).toBeUndefined();
    });

    it('should return undefined for non-existent agent', () => {
      const state = createState({
        agentMap: {},
      });

      expect(
        chatConfigByIdSelectors.getMemoryToolConfigById('non-existent')(state),
      ).toBeUndefined();
    });
  });

  describe('isMemoryToolEnabledById', () => {
    it('should return true when memory is enabled', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { memory: { enabled: true } } },
        },
      });

      expect(chatConfigByIdSelectors.isMemoryToolEnabledById('agent-1')(state)).toBe(true);
    });

    it('should return false when memory is explicitly disabled', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { memory: { enabled: false } } },
        },
      });

      expect(chatConfigByIdSelectors.isMemoryToolEnabledById('agent-1')(state)).toBe(false);
    });

    it('should return false when memory config is not set (default)', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      expect(chatConfigByIdSelectors.isMemoryToolEnabledById('agent-1')(state)).toBe(false);
    });

    it('should return false when memory exists but enabled is not set', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { memory: { effort: 'high' } } },
        },
      });

      expect(chatConfigByIdSelectors.isMemoryToolEnabledById('agent-1')(state)).toBe(false);
    });

    it('should return false for non-existent agent', () => {
      const state = createState({
        agentMap: {},
      });

      expect(chatConfigByIdSelectors.isMemoryToolEnabledById('non-existent')(state)).toBe(false);
    });

    it('should work with different agents independently', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { memory: { enabled: true } } },
          'agent-2': { chatConfig: { memory: { enabled: false } } },
          'agent-3': { chatConfig: {} },
        },
      });

      expect(chatConfigByIdSelectors.isMemoryToolEnabledById('agent-1')(state)).toBe(true);
      expect(chatConfigByIdSelectors.isMemoryToolEnabledById('agent-2')(state)).toBe(false);
      expect(chatConfigByIdSelectors.isMemoryToolEnabledById('agent-3')(state)).toBe(false);
    });
  });

  describe('getMemoryToolEffortById', () => {
    it('should return effort level for specified agent', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { memory: { effort: 'high' } } },
        },
      });

      expect(chatConfigByIdSelectors.getMemoryToolEffortById('agent-1')(state)).toBe('high');
    });

    it('should return "medium" as default when effort is not set', () => {
      const state = createState({
        agentMap: {
          'agent-1': { chatConfig: { memory: { enabled: true } } },
        },
      });

      expect(chatConfigByIdSelectors.getMemoryToolEffortById('agent-1')(state)).toBe('medium');
    });

    it('should return "medium" when memory config is not set', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      expect(chatConfigByIdSelectors.getMemoryToolEffortById('agent-1')(state)).toBe('medium');
    });

    it('should return "medium" for non-existent agent', () => {
      const state = createState({
        agentMap: {},
      });

      expect(chatConfigByIdSelectors.getMemoryToolEffortById('non-existent')(state)).toBe('medium');
    });

    it('should return each effort level correctly', () => {
      const state = createState({
        agentMap: {
          'agent-low': { chatConfig: { memory: { effort: 'low' } } },
          'agent-medium': { chatConfig: { memory: { effort: 'medium' } } },
          'agent-high': { chatConfig: { memory: { effort: 'high' } } },
        },
      });

      expect(chatConfigByIdSelectors.getMemoryToolEffortById('agent-low')(state)).toBe('low');
      expect(chatConfigByIdSelectors.getMemoryToolEffortById('agent-medium')(state)).toBe('medium');
      expect(chatConfigByIdSelectors.getMemoryToolEffortById('agent-high')(state)).toBe('high');
    });
  });

  describe('getSearchFCModelById', () => {
    it('should return searchFCModel from config when explicitly set', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { searchFCModel: { model: 'custom-model', provider: 'openai' } },
          } as any,
        },
      });

      expect(chatConfigByIdSelectors.getSearchFCModelById('agent-1')(state)).toMatchObject({
        model: 'custom-model',
        provider: 'openai',
      });
    });

    it('should return default when not specified', () => {
      const state = createState({
        agentMap: { 'agent-1': {} },
      });

      expect(chatConfigByIdSelectors.getSearchFCModelById('agent-1')(state)).toStrictEqual(
        DEFAULT_AGENT_SEARCH_FC_MODEL,
      );
    });
  });
});
