import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';

import { configReducer } from './config';

describe('configReducer', () => {
  describe('update', () => {
    it('should deep merge self iteration chat config without dropping existing chat config fields', () => {
      const state = {
        ...DEFAULT_AGENT_CONFIG,
        chatConfig: {
          ...DEFAULT_AGENT_CONFIG.chatConfig,
          enableHistoryCount: true,
          historyCount: 12,
        },
      };

      const nextState = configReducer(state, {
        config: {
          chatConfig: {
            selfIteration: {
              enabled: true,
            },
          },
        },
        type: 'update',
      });

      expect(nextState.chatConfig).toMatchObject({
        enableHistoryCount: true,
        historyCount: 12,
        selfIteration: {
          enabled: true,
        },
      });
    });
  });
});
