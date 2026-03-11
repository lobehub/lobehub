import { type UserStore } from '@/store/user';
import { type UserState } from '@/store/user/initialState';
import { initialState } from '@/store/user/initialState';
import { merge } from '@/utils/merge';

import { toolInterventionSelectors } from './toolIntervention';

describe('toolInterventionSelectors', () => {
  describe('approvalMode', () => {
    it('should return "manual" by default when no config exists', () => {
      const s: UserState = merge(initialState, {
        settings: {},
      });

      const result = toolInterventionSelectors.approvalMode(s as UserStore);

      expect(result).toBe('manual');
    });

    it('should return "auto-run" when configured', () => {
      const s: UserState = merge(initialState, {
        settings: {
          tool: {
            humanIntervention: {
              approvalMode: 'auto-run',
            },
          },
        },
      });

      const result = toolInterventionSelectors.approvalMode(s as UserStore);

      expect(result).toBe('auto-run');
    });

    it('should return "allow-list" when configured', () => {
      const s: UserState = merge(initialState, {
        settings: {
          tool: {
            humanIntervention: {
              approvalMode: 'allow-list',
            },
          },
        },
      });

      const result = toolInterventionSelectors.approvalMode(s as UserStore);

      expect(result).toBe('allow-list');
    });

    it('should return "manual" when configured', () => {
      const s: UserState = merge(initialState, {
        settings: {
          tool: {
            humanIntervention: {
              approvalMode: 'manual',
            },
          },
        },
      });

      const result = toolInterventionSelectors.approvalMode(s as UserStore);

      expect(result).toBe('manual');
    });

    it('should fallback to "auto-run" when approvalMode is "headless"', () => {
      const s: UserState = merge(initialState, {
        settings: {
          tool: {
            humanIntervention: {
              approvalMode: 'headless' as any,
            },
          },
        },
      });

      const result = toolInterventionSelectors.approvalMode(s as UserStore);

      // headless is for backend async tasks only, UI should show auto-run
      expect(result).toBe('auto-run');
    });
  });

  describe('allowList', () => {
    it('should return empty array by default', () => {
      const s: UserState = merge(initialState, {
        settings: {},
      });

      const result = toolInterventionSelectors.allowList(s as UserStore);

      expect(result).toEqual([]);
    });

    it('should return configured allowList', () => {
      const allowList = ['bash/bash', 'web-search/search'];
      const s: UserState = merge(initialState, {
        settings: {
          tool: {
            humanIntervention: {
              allowList,
            },
          },
        },
      });

      const result = toolInterventionSelectors.allowList(s as UserStore);

      expect(result).toEqual(allowList);
    });
  });

  describe('config', () => {
    it('should return empty object by default', () => {
      const s: UserState = merge(initialState, {
        settings: {},
      });

      const result = toolInterventionSelectors.config(s as UserStore);

      expect(result).toEqual({});
    });

    it('should return full humanIntervention config', () => {
      const config = {
        approvalMode: 'allow-list' as const,
        allowList: ['bash/bash'],
      };
      const s: UserState = merge(initialState, {
        settings: {
          tool: {
            humanIntervention: config,
          },
        },
      });

      const result = toolInterventionSelectors.config(s as UserStore);

      expect(result).toEqual(config);
    });
  });
});
