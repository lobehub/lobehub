import { isDesktop, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import type { IconProps } from '@lobehub/ui';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCategory } from '@/routes/(main)/settings/hooks/useCategory';
import { SettingsTabs } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors, labPreferSelectors, userProfileSelectors } from '@/store/user/selectors';

import {
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchContext,
  TAB_SEARCH_EN_KEYWORDS,
  TAB_SEARCH_KEYWORDS_KEYS,
} from './items';
import { createSettingsSearchFuse, MAX_SEARCH_RESULTS } from './matcher';
import { containsHan, loadPinyinTexts, type PinyinTexts } from './pinyin';

export interface SettingsSearchResult {
  /** Present on item-level results; used as the URL hash for scroll targeting */
  anchor?: string;
  /** Where the result lives, e.g. `General › Appearance` */
  breadcrumb: string;
  icon?: IconProps['icon'];
  key: string;
  label: string;
  tab: SettingsTabs;
  url: string;
}

interface IndexedEntry extends SettingsSearchResult {
  /** Lowercased searchable texts (label / desc / keywords / …) */
  haystack: string[];
  /**
   * Label/keyword texts that get pinyin variants appended once the dict loads.
   * Descriptions are excluded — their pinyin strings are long and only add
   * fuzzy-match noise.
   */
  pinyinBase: string[];
}

export const getTabUrl = (tab: SettingsTabs) =>
  tab === SettingsTabs.Provider ? '/settings/provider/all' : `/settings/${tab}`;

/** Split a localized comma-separated keyword string (supports CJK commas) */
const splitKeywords = (text: string) =>
  text
    .split(/[,、]/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);

/**
 * Search visible settings by the current-locale label text plus registered
 * keywords, fuzzy-matched via Fuse and pinyin-augmented for Han labels. Tab
 * entries derive from `useCategory` (inheriting its feature-flag / platform
 * gating and `href` overrides); item-level entries come from
 * `SETTINGS_SEARCH_ITEMS` and are dropped when their tab is not visible.
 */
export const useSettingsSearch = (
  query: string,
): {
  /**
   * True while the pinyin dict chunk is still loading for a Han-text index —
   * a zero-result answer is not authoritative yet (pinyin queries like `zhuti`
   * can only match after the dict arrives). Settles to false on load success,
   * failure (graceful non-pinyin degradation), or when no Han text is indexed.
   */
  isIndexing: boolean;
  results: SettingsSearchResult[];
} => {
  const { t } = useTranslation(['setting', 'labs', 'electron', 'subscription', 'spend', 'auth']);
  const categoryGroups = useCategory();
  const { enableSTT, hideDocs, showAiImage } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);
  const enableComposio = useServerConfigStore(serverConfigSelectors.enableComposio);
  const disableEmailPassword = useServerConfigStore(serverConfigSelectors.disableEmailPassword);
  const isLogin = useUserStore(authSelectors.isLogin);
  const enableBuiltinTerminal = useUserStore(labPreferSelectors.enableBuiltinTerminal);
  const hasEmail = useUserStore((s) => !!userProfileSelectors.userProfile(s)?.email);
  const [pinyin, setPinyin] = useState<{ settled: boolean; texts: PinyinTexts | null }>({
    settled: false,
    texts: null,
  });

  // The translated index only depends on locale / visibility inputs — build it
  // once, not on every keystroke.
  const baseIndex = useMemo(() => {
    const ctx: SettingsSearchContext = {
      disableEmailPassword: !!disableEmailPassword,
      enableBusinessFeatures: !!enableBusinessFeatures,
      enableBuiltinTerminal,
      enableComposio: !!enableComposio,
      enableGatewayMode: !!enableGatewayMode,
      enableSTT: !!enableSTT,
      hasEmail,
      hideDocs: !!hideDocs,
      isDesktop,
      isLogin: !!isLogin,
      showAiImage: !!showAiImage,
    };

    // Tab-level entries first so they rank above item-level matches.
    const entries: IndexedEntry[] = [];
    const visibleTabs = new Map<
      SettingsTabs,
      { groupTitle: string; icon?: IconProps['icon']; label: string; url: string }
    >();

    for (const group of categoryGroups) {
      for (const item of group.items) {
        // The same tab may appear in multiple groups (e.g. APIKey in Agent and
        // System when dev mode is on); index only the first occurrence,
        // matching the sidebar's top-to-bottom order — otherwise one query
        // shows duplicate results pointing at the same page.
        if (visibleTabs.has(item.key)) continue;

        const url = item.href ?? getTabUrl(item.key);
        visibleTabs.set(item.key, {
          groupTitle: group.title,
          icon: item.icon,
          label: item.label,
          url,
        });

        const keywordsKey = TAB_SEARCH_KEYWORDS_KEYS[item.key];
        // English floor + localized enrichment (deduped: on en-US they overlap)
        const texts = Array.from(
          new Set([
            item.label.toLowerCase(),
            ...(TAB_SEARCH_EN_KEYWORDS[item.key] ?? []),
            ...(keywordsKey ? splitKeywords(t(keywordsKey as never) as string) : []),
          ]),
        );

        entries.push({
          breadcrumb: group.title,
          haystack: texts,
          icon: item.icon,
          key: `tab-${group.key}-${item.key}`,
          label: item.label,
          pinyinBase: texts,
          tab: item.key,
          url,
        });
      }
    }

    for (const def of SETTINGS_SEARCH_ITEMS) {
      const tabInfo = visibleTabs.get(def.tab);
      if (!tabInfo) continue;
      if (def.visible && !def.visible(ctx)) continue;

      const ns = def.ns ?? 'setting';
      const label = t(def.labelKey as never, { ns }) as string;
      const desc = def.descKey ? (t(def.descKey as never, { ns }) as string) : undefined;
      const keywordTexts = (def.keywords ?? []).map((text) => text.toLowerCase());

      entries.push({
        anchor: def.anchor,
        breadcrumb: `${tabInfo.groupTitle} › ${tabInfo.label}`,
        haystack: [label.toLowerCase(), ...(desc ? [desc.toLowerCase()] : []), ...keywordTexts],
        icon: tabInfo.icon,
        key: `item-${def.anchor}`,
        label,
        pinyinBase: [label.toLowerCase(), ...keywordTexts],
        tab: def.tab,
        url: `${tabInfo.url}#${def.anchor}`,
      });
    }

    // Builtin OAuth connectors (Notion, GitHub, …): searching a connector name
    // should land on the connector page. The page has no per-connector deep
    // link, so these navigate to the tab itself. Availability ultimately
    // depends on the Market API, but this static catalog is what the page
    // renders from.
    const connectorTab = visibleTabs.get(SettingsTabs.Connector);
    if (connectorTab)
      for (const connector of LOBEHUB_SKILL_PROVIDERS) {
        entries.push({
          breadcrumb: `${connectorTab.groupTitle} › ${connectorTab.label}`,
          haystack: [connector.label.toLowerCase(), connector.id.toLowerCase()],
          icon: connectorTab.icon,
          key: `connector-${connector.id}`,
          label: connector.label,
          pinyinBase: [],
          tab: SettingsTabs.Connector,
          url: connectorTab.url,
        });
      }

    // Model providers rank last: builtin names/ids (e.g. "OpenAI") link straight
    // to the provider detail page. Custom providers need an async store fetch and
    // are intentionally not indexed.
    const providerTab = visibleTabs.get(SettingsTabs.Provider);
    if (providerTab)
      for (const provider of DEFAULT_MODEL_PROVIDER_LIST) {
        entries.push({
          breadcrumb: `${providerTab.groupTitle} › ${providerTab.label}`,
          haystack: [provider.name.toLowerCase(), provider.id.toLowerCase()],
          icon: providerTab.icon,
          key: `provider-${provider.id}`,
          label: provider.name,
          pinyinBase: [],
          tab: SettingsTabs.Provider,
          url: `/settings/provider/${provider.id}`,
        });
      }

    return entries;
  }, [
    categoryGroups,
    t,
    disableEmailPassword,
    enableBusinessFeatures,
    enableBuiltinTerminal,
    enableComposio,
    enableGatewayMode,
    enableSTT,
    hasEmail,
    hideDocs,
    isLogin,
    showAiImage,
  ]);

  // Load the pinyin dict only when the index actually contains Han text, so
  // non-CJK locales never download it.
  const needsPinyin = useMemo(
    () => baseIndex.some((entry) => entry.pinyinBase.some((text) => containsHan(text))),
    [baseIndex],
  );

  useEffect(() => {
    if (!needsPinyin || pinyin.settled) return;

    let active = true;
    // Settle even on load failure (texts stays null) so isIndexing can't stick.
    loadPinyinTexts().then((fn) => {
      if (active) setPinyin({ settled: true, texts: fn });
    });
    return () => {
      active = false;
    };
  }, [needsPinyin, pinyin.settled]);

  const fuse = useMemo(() => {
    const pinyinTexts = pinyin.texts;
    const index = pinyinTexts
      ? baseIndex.map((entry) =>
          entry.pinyinBase.some((text) => containsHan(text))
            ? { ...entry, haystack: [...entry.haystack, ...entry.pinyinBase.flatMap(pinyinTexts)] }
            : entry,
        )
      : baseIndex;

    return createSettingsSearchFuse(index);
  }, [baseIndex, pinyin.texts]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];

    return fuse
      .search(q, { limit: MAX_SEARCH_RESULTS })
      .map(({ item: { haystack: _h, pinyinBase: _p, ...result } }) => result);
  }, [query, fuse]);

  return { isIndexing: needsPinyin && !pinyin.settled, results };
};
