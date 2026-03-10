import { type GlobalState } from '@/store/global/initialState';
import { initialState } from '@/store/global/initialState';
import { merge } from '@/utils/merge';

import { globalGeneralSelectors } from './general';

describe('settingsSelectors', () => {
  describe('currentLanguage', () => {
    it('should return the correct language setting', () => {
      const s: GlobalState = merge(initialState, {
        status: { language: 'fr' },
      });

      const result = globalGeneralSelectors.currentLanguage(s);

      expect(result).toBe('fr');
    });
  });
});
