import { useTranslation } from 'react-i18next';

import {
  getSettingsScopeEntryTab,
  type ScopedSettingsGroup,
  type SettingsScope,
} from './settingsScope';
import { type SettingsSpace } from './useSettingsScopeTitle';

export interface SettingsBreadcrumbItem {
  href: string;
  title: string;
}

interface UseSettingsBreadcrumbOptions<Group extends ScopedSettingsGroup> {
  /** Used when a set lists no tab. */
  fallbackHref: string;
  groups: Group[];
  scope: SettingsScope;
  space: SettingsSpace;
  /** `personal` for `/settings/*`, the workspace slug for `/:slug/settings/*`. */
  spaceKey: string;
  tabUrl: (tab: Group['items'][number]['key']) => string;
}

/**
 * Settings sidebar breadcrumb. The space's settings are the root
 * ("LobeHub Settings", "Personal Space Settings"); account settings sit one
 * level below it ("LobeHub Settings › Account Settings"), so the root also
 * leads back from account settings to the space's own.
 */
export const useSettingsBreadcrumb = <Group extends ScopedSettingsGroup>({
  fallbackHref,
  groups,
  scope,
  space,
  spaceKey,
  tabUrl,
}: UseSettingsBreadcrumbOptions<Group>): SettingsBreadcrumbItem[] => {
  const { t } = useTranslation('setting');

  const hrefOf = (target: SettingsScope) => {
    const tab = getSettingsScopeEntryTab(spaceKey, target, groups);
    return tab ? tabUrl(tab) : fallbackHref;
  };

  const spaceTitle =
    space.kind === 'workspace'
      ? t('settingsSwitch.workspace', { name: space.name })
      : t('settingsSwitch.personalSpace');

  const items: SettingsBreadcrumbItem[] = [{ href: hrefOf('space'), title: spaceTitle }];
  if (scope === 'account')
    items.push({ href: hrefOf('account'), title: t('settingsSwitch.account') });

  return items;
};
