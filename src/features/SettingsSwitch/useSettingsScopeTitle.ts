import { useTranslation } from 'react-i18next';

import { type SettingsScope } from './settingsScope';

export type SettingsSpace =
  { kind: 'personal' } | { avatar?: string | null; kind: 'workspace'; name: string };

/**
 * Name of a settings set: "Account Settings", "Personal Space Settings" or
 * "<Workspace> Settings".
 */
export const useSettingsScopeTitle = (scope: SettingsScope, space: SettingsSpace) => {
  const { t } = useTranslation('setting');

  if (scope === 'account') return t('settingsSwitch.account');
  if (space.kind === 'workspace') return t('settingsSwitch.workspace', { name: space.name });
  return t('settingsSwitch.personalSpace');
};
