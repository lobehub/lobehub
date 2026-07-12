import { isDesktop } from '@lobechat/const';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCategory } from '@/routes/(main)/settings/hooks/useCategory';
import { SettingsTabs } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';

import {
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchContext,
  TAB_SEARCH_KEYWORDS_KEYS,
} from './items';

export interface SettingsSearchResult {
  /** Present on item-level results; used as the URL hash for scroll targeting */
  anchor?: string;
  /** Where the result lives, e.g. `General › Appearance` */
  breadcrumb: string;
  icon?: any;
  key: string;
  label: string;
  tab: SettingsTabs;
  url: string;
}

interface IndexedEntry extends SettingsSearchResult {
  /** Lowercased searchable texts (label / desc / keywords / …) */
  haystack: string[];
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
 * keywords. Tab-level entries derive from `useCategory` (inheriting its
 * feature-flag / platform gating and `href` overrides); item-level entries come
 * from `SETTINGS_SEARCH_ITEMS` and are dropped when their tab is not visible.
 */
export const useSettingsSearch = (query: string): SettingsSearchResult[] => {
  const { t } = useTranslation(['setting', 'labs', 'electron']);
  const categoryGroups = useCategory();
  const { enableSTT, hideDocs, showAiImage } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);

  // The translated index only depends on locale / visibility inputs — build it
  // once, not on every keystroke.
  const index = useMemo(() => {
    const ctx: SettingsSearchContext = {
      enableBusinessFeatures: !!enableBusinessFeatures,
      enableGatewayMode: !!enableGatewayMode,
      enableSTT: !!enableSTT,
      hideDocs: !!hideDocs,
      isDesktop,
      showAiImage: !!showAiImage,
    };

    // Tab-level entries first so they rank above item-level matches.
    const entries: IndexedEntry[] = [];
    const visibleTabs = new Map<
      SettingsTabs,
      { groupTitle: string; icon?: any; label: string; url: string }
    >();

    for (const group of categoryGroups) {
      for (const item of group.items) {
        const url = item.href ?? getTabUrl(item.key);

        // The same tab may appear in multiple groups (e.g. APIKey); keep the
        // first occurrence, matching the sidebar's top-to-bottom order.
        if (!visibleTabs.has(item.key))
          visibleTabs.set(item.key, {
            groupTitle: group.title,
            icon: item.icon,
            label: item.label,
            url,
          });

        const keywordsKey = TAB_SEARCH_KEYWORDS_KEYS[item.key];

        entries.push({
          breadcrumb: group.title,
          haystack: [
            item.label.toLowerCase(),
            ...(keywordsKey ? splitKeywords(t(keywordsKey as never) as string) : []),
          ],
          icon: item.icon,
          key: `tab-${group.key}-${item.key}`,
          label: item.label,
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

      entries.push({
        anchor: def.anchor,
        breadcrumb: `${tabInfo.groupTitle} › ${tabInfo.label}`,
        haystack: [label, desc, ...(def.keywords ?? [])]
          .filter(Boolean)
          .map((text) => text!.toLowerCase()),
        icon: tabInfo.icon,
        key: `item-${def.anchor}`,
        label,
        tab: def.tab,
        url: `${tabInfo.url}#${def.anchor}`,
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
          tab: SettingsTabs.Provider,
          url: `/settings/provider/${provider.id}`,
        });
      }

    return entries;
  }, [
    categoryGroups,
    t,
    enableBusinessFeatures,
    enableGatewayMode,
    enableSTT,
    hideDocs,
    showAiImage,
  ]);

  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return index
      .filter((entry) => entry.haystack.some((text) => text.includes(q)))
      .map(({ haystack: _, ...result }) => result);
  }, [query, index]);
};
