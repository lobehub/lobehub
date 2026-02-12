import { describe, expect, it } from 'vitest';

import { type ToolStoreState } from '../../initialState';
import { initialState } from '../../initialState';
import { pluginStoreSelectors } from './selectors';

const mockState = {
  ...initialState,
  listType: 'old',
  oldPluginItems: [
    {
      identifier: 'plugin-1',
      author: 'Author 1',
      createdAt: '2021-01-01',
      avatar: 'avatar-url-1',
      title: 'Plugin 1',
      homepage: 'http://homepage-1.com',
    },
    {
      identifier: 'plugin-2',
      author: 'Author 2',
      createdAt: '2022-02-02',
      avatar: 'avatar-url-2',
      title: 'Plugin 2',
      homepage: 'http://homepage-2.com',
    },
  ],
} as ToolStoreState;

describe('pluginStoreSelectors', () => {
  describe('onlinePluginStore', () => {
    it('should return the online plugin list', () => {
      const result = pluginStoreSelectors.onlinePluginStore(mockState);
      expect(result).toEqual([
        {
          identifier: 'plugin-1',
          author: 'Author 1',
          createdAt: '2021-01-01',
          meta: { avatar: 'avatar-url-1', title: 'Plugin 1' },
          homepage: 'http://homepage-1.com',
          type: 'plugin',
        },
        {
          identifier: 'plugin-2',
          author: 'Author 2',
          createdAt: '2022-02-02',
          meta: { avatar: 'avatar-url-2', title: 'Plugin 2' },
          homepage: 'http://homepage-2.com',
          type: 'plugin',
        },
      ]);
    });
  });
});
