import { describe, expect, it } from 'vitest';

import { LAB_FEATURES } from '@/features/Settings/labs/features';
import { SettingsTabs } from '@/store/global/initialState';

import {
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchContext,
  TAB_SEARCH_EN_KEYWORDS,
  TAB_SEARCH_KEYWORDS_KEYS,
} from './items';

const webContext: SettingsSearchContext = {
  disableEmailPassword: false,
  enableBusinessFeatures: true,
  enableComposio: true,
  enableGatewayMode: true,
  enableSTT: true,
  hasEmail: true,
  hideDocs: false,
  isDesktop: false,
  isLogin: true,
  isWindows: false,
  showAiImage: true,
};

describe('settings search index', () => {
  it('derives one search item per lab feature in catalog order', () => {
    const labsItems = SETTINGS_SEARCH_ITEMS.filter((item) => item.tab === SettingsTabs.Labs);

    expect(labsItems.map((item) => item.anchor)).toEqual(
      LAB_FEATURES.map(({ flag }) => `labs-${flag}`),
    );
  });

  it('hides desktop-only lab features from web search results', () => {
    const labsItems = SETTINGS_SEARCH_ITEMS.filter((item) => item.tab === SettingsTabs.Labs);

    for (const feature of LAB_FEATURES) {
      const item = labsItems.find(({ anchor }) => anchor === `labs-${feature.flag}`)!;
      expect(item.visible?.(webContext) ?? true).toBe(!feature.desktopOnly);
    }
  });

  it('indexes the inbox notification channel', () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.anchor === 'notification-inbox')).toBe(true);
  });

  it('keeps an English floor for labs and oauth apps tabs', () => {
    expect(TAB_SEARCH_EN_KEYWORDS[SettingsTabs.Labs]).toContain('experiment');
    expect(TAB_SEARCH_EN_KEYWORDS[SettingsTabs.OAuthApps]).toContain('oauth');
    expect(TAB_SEARCH_KEYWORDS_KEYS[SettingsTabs.Labs]).toBe('settingsSearch.tabKeywords.labs');
    expect(TAB_SEARCH_KEYWORDS_KEYS[SettingsTabs.OAuthApps]).toBe(
      'settingsSearch.tabKeywords.oauthApps',
    );
  });

  it('covers the high-volume zero-result phrases as tab keywords', () => {
    expect(TAB_SEARCH_EN_KEYWORDS[SettingsTabs.Provider]).toEqual(
      expect.arrayContaining(['api', 'model provider', 'language model', 'custom provider']),
    );
    expect(TAB_SEARCH_EN_KEYWORDS[SettingsTabs.Messenger]).toEqual(
      expect.arrayContaining(['telegram', 'slack', 'discord', 'wechat']),
    );
    expect(TAB_SEARCH_EN_KEYWORDS[SettingsTabs.ServiceModel]).toEqual(
      expect.arrayContaining(['search', 'tts settings']),
    );
    expect(TAB_SEARCH_EN_KEYWORDS[SettingsTabs.Storage]).toEqual(
      expect.arrayContaining(['knowledge base']),
    );
  });
});
