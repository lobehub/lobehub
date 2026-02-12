import { describe, expect, it } from 'vitest';

import { DEFAULT_AVATAR } from '@/const/meta';
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
  describe('getAvatar', () => {
    it('should return the avatar from the meta data', () => {
      const meta: MetaData = { avatar: 'custom-avatar.png' };
      const avatar = sessionMetaSelectors.getAvatar(meta);
      expect(avatar).toBe(meta.avatar);
    });

    it('should return the default avatar if none is defined in the meta data', () => {
      const meta: MetaData = {};
      const avatar = sessionMetaSelectors.getAvatar(meta);
      expect(avatar).toBe(DEFAULT_AVATAR);
    });
  });

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

  describe('getDescription', () => {
    it('should return the description from the meta data', () => {
      const meta: MetaData = { description: 'Custom Description' };
      const description = sessionMetaSelectors.getDescription(meta);
      expect(description).toBe(meta.description);
    });

    it('should return the default description if none is defined in the meta data', () => {
      const meta: MetaData = {};
      const description = sessionMetaSelectors.getDescription(meta);
      expect(description).toBe(undefined); // Assuming translation returns this key
    });
  });
});
