import { describe, expect, it } from 'vitest';

import { type UserStore } from '@/store/user';

import { initialPreferenceState } from './initialState';
import { labPreferSelectors, preferenceSelectors } from './selectors';

describe('preferenceSelectors', () => {
  let store: UserStore;

  beforeEach(() => {
    store = {
      ...initialPreferenceState,
    } as unknown as UserStore;
  });

  describe('useCmdEnterToSend', () => {
    it('should return the value of useCmdEnterToSend preference', () => {
      store.preference.useCmdEnterToSend = true;
      expect(preferenceSelectors.useCmdEnterToSend(store)).toBe(true);

      store.preference.useCmdEnterToSend = false;
      expect(preferenceSelectors.useCmdEnterToSend(store)).toBe(false);
    });

    it('should return false if useCmdEnterToSend preference is undefined', () => {
      store.preference.useCmdEnterToSend = undefined;
      expect(preferenceSelectors.useCmdEnterToSend(store)).toBe(false);
    });
  });

  describe('hideSyncAlert', () => {
    it('should return the value of hideSyncAlert preference', () => {
      store.preference.hideSyncAlert = true;
      expect(preferenceSelectors.hideSyncAlert(store)).toBe(true);

      store.preference.hideSyncAlert = false;
      expect(preferenceSelectors.hideSyncAlert(store)).toBe(false);

      store.preference.hideSyncAlert = undefined;
      expect(preferenceSelectors.hideSyncAlert(store)).toBeUndefined();
    });
  });

  describe('hideSettingsMoveGuide', () => {
    it('should return the value of moveSettingsToAvatar guide preference', () => {
      store.preference.guide = { moveSettingsToAvatar: true };
      expect(preferenceSelectors.hideSettingsMoveGuide(store)).toBe(true);

      store.preference.guide = { moveSettingsToAvatar: false };
      expect(preferenceSelectors.hideSettingsMoveGuide(store)).toBe(false);
    });

    it('should return undefined if guide preference is undefined', () => {
      store.preference.guide = undefined;
      expect(preferenceSelectors.hideSettingsMoveGuide(store)).toBeUndefined();
    });
  });

  describe('isPreferenceInit', () => {
    it('should return the value of isPreferenceInit state', () => {
      store.isUserStateInit = true;
      expect(preferenceSelectors.isPreferenceInit(store)).toBe(true);

      store.isUserStateInit = false;
      expect(preferenceSelectors.isPreferenceInit(store)).toBe(false);
    });
  });

  describe('labPreferSelectors', () => {
    it('returns false for agent document floating chat panel by default', () => {
      store.preference.lab = undefined;

      expect(labPreferSelectors.enableAgentDocumentFloatingChatPanel(store)).toBe(false);
    });

    it('returns the configured agent document floating chat panel preference', () => {
      store.preference.lab = { enableAgentDocumentFloatingChatPanel: true };

      expect(labPreferSelectors.enableAgentDocumentFloatingChatPanel(store)).toBe(true);
    });

    it('returns false for message text selection actions by default', () => {
      store.preference.lab = undefined;

      expect(labPreferSelectors.enableMessageTextSelectionActions(store)).toBe(false);
    });

    it('returns the configured message text selection actions preference', () => {
      store.preference.lab = { enableMessageTextSelectionActions: true };

      expect(labPreferSelectors.enableMessageTextSelectionActions(store)).toBe(true);
    });
  });
});
