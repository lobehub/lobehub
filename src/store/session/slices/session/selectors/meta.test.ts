import { describe, expect, it } from 'vitest';

import { type MetaData } from '@/types/meta';

import { sessionMetaSelectors } from './meta';

vi.mock('i18next', () => ({
  t: vi.fn((key) => key), // Simplified mock return value
}));

/**
 * Note: Agent-related meta selectors (currentAgentMeta, currentAgentTitle, currentAgentDescription, etc.)
 * have been moved to agentSelectors in @/store/agent/selectors.
 * See agentSelectors tests for those.
 */
describe('sessionMetaSelectors', () => {
  describe('getTitle', () => {
    it('should return the title from the meta data', () => {
      const meta: MetaData = { title: 'Custom Title' };
      const title = sessionMetaSelectors.getTitle(meta);
      expect(title).toBe(meta.title);
    });

    it('should return the default title if none is defined in the meta data', () => {
      const meta: MetaData = {};
      const title = sessionMetaSelectors.getTitle(meta);
      expect(title).toBe('defaultSession'); // Assuming translation returns this key
    });
  });
});
