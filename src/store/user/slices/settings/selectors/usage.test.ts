import type { UserStore } from '@/store/user';
import type { UserState } from '@/store/user/initialState';
import { initialState } from '@/store/user/initialState';
import { merge } from '@/utils/merge';

import { userUsageSettingsSelectors } from './usage';

describe('userUsageSettingsSelectors', () => {
  describe('costEstimateWarningThreshold', () => {
    it('should return the default threshold', () => {
      const result = userUsageSettingsSelectors.costEstimateWarningThreshold(
        initialState as UserStore,
      );

      expect(result).toBe(2);
    });

    it('should read the persisted threshold from general settings', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: { costEstimateWarningThreshold: 0.5 },
        },
      });

      const result = userUsageSettingsSelectors.costEstimateWarningThreshold(s as UserStore);

      expect(result).toBe(0.5);
    });
  });
});
