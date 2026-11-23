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
        costEstimateWarningThreshold: 0.5,
        fontSize: 12,
        highlighterTheme: 'lobe-theme',
        interfaceDensity: 'loose',
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

  describe('showMessageUsage', () => {
    it('is off when nothing was chosen', () => {
      expect(userGeneralSettingsSelectors.showMessageUsage(initialState as UserStore)).toBe(false);
    });

    it('keeps it on for people who had the retired Advanced Tools switch on', () => {
      const s = merge(initialState, {
        settings: { general: { isDevMode: true } },
      }) as unknown as UserStore;

      expect(userGeneralSettingsSelectors.showMessageUsage(s)).toBe(true);
    });

    it('lets the explicit choice win over the retired switch', () => {
      const s = merge(initialState, {
        settings: { general: { isDevMode: true, showMessageUsage: false } },
      }) as unknown as UserStore;

      expect(userGeneralSettingsSelectors.showMessageUsage(s)).toBe(false);
    });
  });

  describe('interfaceDensity', () => {
    it('defaults to loose when unset', () => {
      expect(userGeneralSettingsSelectors.interfaceDensity(initialState as UserStore)).toBe(
        'loose',
      );
    });

    it('returns compact when chosen', () => {
      const s: UserState = merge(initialState, {
        settings: { general: { interfaceDensity: 'compact' } },
      });

      expect(userGeneralSettingsSelectors.interfaceDensity(s as UserStore)).toBe('compact');
    });
  });

  describe('fontAntialiasing', () => {
    it('should default to true when unset', () => {
      expect(userGeneralSettingsSelectors.fontAntialiasing(initialState as UserStore)).toBe(true);
    });

    it('should return false when turned off', () => {
      const s: UserState = merge(initialState, {
        settings: { general: { fontAntialiasing: false } },
      });

      expect(userGeneralSettingsSelectors.fontAntialiasing(s as UserStore)).toBe(false);
    });
  });

  describe('followUpBehavior', () => {
    it('should stay on the legacy behavior while the lab is off, whatever is stored', () => {
      const s: UserState = merge(initialState, {
        settings: { general: { followUpBehavior: 'queue' } },
      });

      expect(userGeneralSettingsSelectors.followUpBehavior(s as UserStore)).toBe('legacy');
    });

    it('should default to steer with the lab on', () => {
      const s: UserState = merge(initialState, {
        preference: { lab: { enableBetterCodingExperience: true } },
      });

      expect(userGeneralSettingsSelectors.followUpBehavior(s as UserStore)).toBe('steer');
    });

    it('should read the stored setting with the lab on', () => {
      const s: UserState = merge(initialState, {
        preference: { lab: { enableBetterCodingExperience: true } },
        settings: { general: { followUpBehavior: 'queue' } },
      });

      expect(userGeneralSettingsSelectors.followUpBehavior(s as UserStore)).toBe('queue');
    });
  });

  describe('enablePasteAutoConvert', () => {
    it('should default to true when unset', () => {
      expect(userGeneralSettingsSelectors.enablePasteAutoConvert(initialState as UserStore)).toBe(
        true,
      );
    });

    it('should return false when turned off', () => {
      const s: UserState = merge(initialState, {
        settings: { general: { enablePasteAutoConvert: false } },
      });

      expect(userGeneralSettingsSelectors.enablePasteAutoConvert(s as UserStore)).toBe(false);
    });

    it('should default to false for users who turned off the retired input markdown lab', () => {
      const s: UserState = merge(initialState, {
        preference: { lab: { enableInputMarkdown: false } },
      });

      expect(userGeneralSettingsSelectors.enablePasteAutoConvert(s as UserStore)).toBe(false);
    });

    it('should let the explicit setting win over the retired lab', () => {
      const s: UserState = merge(initialState, {
        preference: { lab: { enableInputMarkdown: false } },
        settings: { general: { enablePasteAutoConvert: true } },
      });

      expect(userGeneralSettingsSelectors.enablePasteAutoConvert(s as UserStore)).toBe(true);
    });
  });

  describe('enableVoiceMessage', () => {
    it('should default to false when unset', () => {
      expect(userGeneralSettingsSelectors.enableVoiceMessage(initialState as UserStore)).toBe(
        false,
      );
    });

    it('should return true when turned on', () => {
      const s: UserState = merge(initialState, {
        settings: { general: { enableVoiceMessage: true } },
      });

      expect(userGeneralSettingsSelectors.enableVoiceMessage(s as UserStore)).toBe(true);
    });

    it('should return false when explicitly turned off', () => {
      const s: UserState = merge(initialState, {
        settings: { general: { enableVoiceMessage: false } },
      });

      expect(userGeneralSettingsSelectors.enableVoiceMessage(s as UserStore)).toBe(false);
    });
  });

  describe('currentResponseLanguage', () => {
    it('should prefer the saved response language', () => {
      const s: UserState = merge(initialState, {
        settings: {
          general: { responseLanguage: 'zh-CN' },
        },
      });

      const result = userGeneralSettingsSelectors.currentResponseLanguage(s as UserStore);

      expect(result).toBe('zh-CN');
    });

    it('should fallback to the normalized browser language', () => {
      const originalLanguage = navigator.language;
      Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'fr' });

      const s: UserState = merge(initialState, {
        settings: {
          general: {},
        },
      });

      const result = userGeneralSettingsSelectors.currentResponseLanguage(s as UserStore);

      expect(result).toBe('fr-FR');

      Object.defineProperty(window.navigator, 'language', {
        configurable: true,
        value: originalLanguage,
      });
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
