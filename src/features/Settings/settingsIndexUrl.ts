import { getTabUrl } from '@/features/SettingsSearch';
import { getSettingsDefaultTab } from '@/features/SettingsSwitch/settingsScope';
import { SettingsTabs } from '@/store/global/initialState';

import { type CategoryGroup } from './hooks/useCategory';

/**
 * Where `/settings` lands: the personal space set's first tab, so settings
 * lead with the space instead of the account set. Profile is the fallback
 * when the space lists no tab.
 */
export const getSettingsIndexUrl = (groups: Pick<CategoryGroup, 'items' | 'scope'>[]): string =>
  getTabUrl(getSettingsDefaultTab(groups) ?? SettingsTabs.Profile);
