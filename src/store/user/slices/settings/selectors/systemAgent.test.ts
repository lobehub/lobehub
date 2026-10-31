import { describe, expect, it } from 'vitest';

import { type UserStore } from '../../../store';
import { systemAgentSelectors } from './systemAgent';

describe('systemAgentSelectors', () => {
  describe('defaultInputCompletion', () => {
    it('resolves the deployment default and ignores the personal model choice', () => {
      const s = {
        defaultSettings: {
          systemAgent: { inputCompletion: { model: 'gpt-5.6-luna', provider: 'lobehub' } },
        },
        settings: {
          systemAgent: {
            inputCompletion: { enabled: true, model: 'deepseek-v4-flash', provider: 'deepseek' },
          },
        },
      } as unknown as UserStore;

      expect(systemAgentSelectors.inputCompletion(s)).toMatchObject({
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
      });
      expect(systemAgentSelectors.defaultInputCompletion(s)).toMatchObject({
        model: 'gpt-5.6-luna',
        provider: 'lobehub',
      });
    });
  });
});
