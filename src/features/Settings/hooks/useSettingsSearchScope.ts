import { useMemo } from 'react';

import type {
  SettingsSearchCategoryGroup,
  SettingsSearchScope,
  SettingsSearchTab,
} from '@/features/SettingsSearch';
import { SettingsTabs } from '@/store/global/initialState';

/**
 * Personal Usage holds the balance (`/settings/credits` redirects into it), so
 * it answers the balance keywords as well. Workspace settings keep a separate
 * Credits page and do not merge them.
 */
const MERGED_TABS: Partial<Record<string, readonly SettingsSearchTab[]>> = {
  [SettingsTabs.Usage]: [SettingsTabs.Credits],
};

/** Settings-search scope for the personal sidebar. */
export const usePersonalSettingsSearchScope = (
  categoryGroups: SettingsSearchCategoryGroup[],
): SettingsSearchScope =>
  useMemo(() => ({ categoryGroups, mergedTabs: MERGED_TABS }), [categoryGroups]);
