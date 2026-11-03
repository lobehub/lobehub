import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';

import { type Store } from './action';
import { selectors } from './selectors';

describe('AgentSetting selectors', () => {
  describe('currentChatConfig', () => {
    it('should include disabled self iteration by default', () => {
      const state = {
        config: DEFAULT_AGENT_CONFIG,
      } as Store;

      expect(selectors.currentChatConfig(state).selfIteration).toEqual({ enabled: false });
    });
  });
});
