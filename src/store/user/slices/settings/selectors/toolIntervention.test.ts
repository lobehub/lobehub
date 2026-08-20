import { DEFAULT_TOOL_APPROVAL_MODE } from '@lobechat/business-const';

import { type UserStore } from '@/store/user';
import { type UserState } from '@/store/user/initialState';
import { initialState } from '@/store/user/initialState';
import { merge } from '@/utils/merge';

import { toolInterventionSelectors } from './toolIntervention';

describe('toolInterventionSelectors', () => {
  describe('approvalMode', () => {
    /**
     * Asserted against the slot rather than the literal `manual`, because the
     * value is the distribution's to choose — a build that ships a different
     * default is configured, not broken, and hard-coding the expectation here
     * would fail that build for doing the supported thing.
     */
    it('falls back to the distribution default when no config exists', () => {
      const s: UserState = merge(initialState, {
        settings: {},
      });

      const result = toolInterventionSelectors.approvalMode(s as UserStore);

      expect(result).toBe(DEFAULT_TOOL_APPROVAL_MODE);
    });

    it('lets an explicit choice win over the distribution default', () => {
      // Whichever way the default points, the other two modes must still be
      // reachable — the setting is a default, not a policy.
      for (const mode of ['auto-run', 'allow-list', 'manual'] as const) {
        const s: UserState = merge(initialState, {
          settings: { tool: { humanIntervention: { approvalMode: mode } } },
        });

        expect(toolInterventionSelectors.approvalMode(s as UserStore)).toBe(mode);
      }
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
