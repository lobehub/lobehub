import { type UserStore } from '@/store/user';
import { type UserState } from '@/store/user/initialState';
import { initialState } from '@/store/user/initialState';
import { merge } from '@/utils/merge';

import { userGeneralSettingsSelectors } from './general';

describe('settingsSelectors', () => {
  describe('generalConfig', () => {
    it('should return general settings', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: { fontSize: 12 },
        },
      });

      const result = userGeneralSettingsSelectors.config(s as UserStore);

      expect(result).toEqual({
        animationMode: 'agile',
        fontSize: 12,
        highlighterTheme: 'lobe-theme',
        isDevMode: false,
        isLiteMode: false,
        mermaidTheme: 'lobe-theme',
        telemetry: true,
        transitionMode: 'fadeIn',
      });
    });
  });

  describe('fontSize', () => {
    it('should return the fontSize', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: { fontSize: 12 },
        },
      });

      const result = userGeneralSettingsSelectors.fontSize(s as UserStore);

      expect(result).toBe(12);
    });
  });

  describe('neutralColor', () => {
    it('should return undefined if general settings not exists', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: undefined,
        },
      });

      const result = userGeneralSettingsSelectors.neutralColor(s as UserStore);

      expect(result).toBeUndefined();
    });

    it('should return undefined if neutralColor not set', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: {},
        },
      });

      const result = userGeneralSettingsSelectors.neutralColor(s as UserStore);

      expect(result).toBeUndefined();
    });

    it('should return the neutralColor', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: { neutralColor: '#000000' },
        },
      });

      const result = userGeneralSettingsSelectors.neutralColor(s as UserStore);

      expect(result).toBe('#000000');
    });
  });

  describe('primaryColor', () => {
    it('should return undefined if general settings not exists', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: undefined,
        },
      });

      const result = userGeneralSettingsSelectors.primaryColor(s as UserStore);

      expect(result).toBeUndefined();
    });

    it('should return undefined if primaryColor not set', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: {},
        },
      });

      const result = userGeneralSettingsSelectors.primaryColor(s as UserStore);

      expect(result).toBeUndefined();
    });

    it('should return the primaryColor', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: { primaryColor: '#ffffff' },
        },
      });

      const result = userGeneralSettingsSelectors.primaryColor(s as UserStore);

      expect(result).toBe('#ffffff');
    });
  });

  it('should return the highlighterTheme', () => {
    const s: UserState = merge(initialState, {
      settings: {
        general: { highlighterTheme: 'lobe-theme' },
      },
    });

    const result = userGeneralSettingsSelectors.highlighterTheme(s as UserStore);

    expect(result).toBe('lobe-theme');
  });

  it('should return the mermaidTheme', () => {
    const s: UserState = merge(initialState, {
      settings: {
        general: { mermaidTheme: 'lobe-theme' },
      },
    });

    const result = userGeneralSettingsSelectors.mermaidTheme(s as UserStore);

    expect(result).toBe('lobe-theme');
  });
});
