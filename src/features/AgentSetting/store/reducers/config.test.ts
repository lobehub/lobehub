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

  describe('togglePlugin', () => {
    it('pins a new identifier when absent', () => {
      const state = { ...DEFAULT_AGENT_CONFIG, plugins: ['plugin-a'] };

      const nextState = configReducer(state, {
        pluginId: 'plugin-b',
        type: 'togglePlugin',
      });

      expect(nextState.plugins).toEqual(['plugin-a', { identifier: 'plugin-b', mode: 'pinned' }]);
    });

    it('unpins an already-pinned legacy string entry with an explicit auto mode', () => {
      const state = { ...DEFAULT_AGENT_CONFIG, plugins: ['plugin-a', 'plugin-b'] };

      const nextState = configReducer(state, {
        pluginId: 'plugin-b',
        type: 'togglePlugin',
      });

      expect(nextState.plugins).toEqual(['plugin-a', { identifier: 'plugin-b', mode: 'auto' }]);
    });

    it('flips an existing disabled object entry back to pinned, without duplicating it', () => {
      const state = {
        ...DEFAULT_AGENT_CONFIG,
        plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'disabled' }] as any,
      };

      const nextState = configReducer(state, {
        pluginId: 'plugin-b',
        state: true,
        type: 'togglePlugin',
      });

      expect(nextState.plugins).toEqual(['plugin-a', { identifier: 'plugin-b', mode: 'pinned' }]);
    });

    it('explicit state=false persists the auto mode', () => {
      const state = {
        ...DEFAULT_AGENT_CONFIG,
        plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'disabled' }] as any,
      };

      const nextState = configReducer(state, {
        pluginId: 'plugin-b',
        state: false,
        type: 'togglePlugin',
      });

      expect(nextState.plugins).toEqual(['plugin-a', { identifier: 'plugin-b', mode: 'auto' }]);
    });
  });
});
