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

  describe('terminalFontFamily', () => {
    it('returns the configured font family without surrounding whitespace', () => {
      store.preference.terminalFontFamily = '  JetBrains Mono  ';

      expect(preferenceSelectors.terminalFontFamily(store)).toBe('JetBrains Mono');
    });

    it('falls back when the configured font family is empty', () => {
      store.preference.terminalFontFamily = '   ';

      expect(preferenceSelectors.terminalFontFamily(store)).toBeUndefined();
    });
  });

  describe('labPreferSelectors', () => {
    it('keeps desktop split view disabled by default', () => {
      store.preference.lab = undefined;

      expect(labPreferSelectors.enableDesktopSplitView(store)).toBe(false);
    });

    it('returns the configured desktop split view preference', () => {
      store.preference.lab = { enableDesktopSplitView: true };

      expect(labPreferSelectors.enableDesktopSplitView(store)).toBe(true);
    });

    it('should default project workspaces to disabled and honor the lab preference', () => {
      store.preference.lab = undefined;
      expect(labPreferSelectors.enableProjects(store)).toBe(false);

      store.preference.lab = { enableProjects: true };
      expect(labPreferSelectors.enableProjects(store)).toBe(true);
    });

    it('returns false for message text selection actions by default', () => {
      store.preference.lab = undefined;

      expect(labPreferSelectors.enableMessageTextSelectionActions(store)).toBe(false);
    });

    it('returns the configured message text selection actions preference', () => {
      store.preference.lab = { enableMessageTextSelectionActions: true };

      expect(labPreferSelectors.enableMessageTextSelectionActions(store)).toBe(true);
    });

    it('keeps agent provider binding disabled by default', () => {
      store.preference.lab = undefined;

      expect(labPreferSelectors.enableAgentProviderBinding(store)).toBe(false);
    });

    it('returns the configured agent provider binding preference', () => {
      store.preference.lab = { enableAgentProviderBinding: true };

      expect(labPreferSelectors.enableAgentProviderBinding(store)).toBe(true);
    });

    it('keeps the feature on for users who enabled it under the legacy Claude-specific key', () => {
      store.preference.lab = { enableClaudeCodeApiMode: true };

      expect(labPreferSelectors.enableAgentProviderBinding(store)).toBe(true);
    });

    it('lets an explicit new-key choice override the legacy key', () => {
      store.preference.lab = { enableAgentProviderBinding: false, enableClaudeCodeApiMode: true };

      expect(labPreferSelectors.enableAgentProviderBinding(store)).toBe(false);
    });

    it('keeps OAuth app management hidden by default', () => {
      store.preference.lab = undefined;

      expect(labPreferSelectors.enableOAuthApps(store)).toBe(false);
    });

    it('returns the configured OAuth app management preference', () => {
      store.preference.lab = { enableOAuthApps: true };

      expect(labPreferSelectors.enableOAuthApps(store)).toBe(true);
    });
  });
});
