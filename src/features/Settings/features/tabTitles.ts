import { useTranslation } from 'react-i18next';

import { SettingsTabs } from '@/store/global/initialState';

type TitleKey = readonly [namespace: string, key: string];

/**
 * The navigation-header title of each settings tab. It is static copy, so the
 * route and chunk skeletons render the same text the settled page shows instead
 * of a placeholder bar.
 */
export const SETTINGS_TAB_TITLE_KEYS: Partial<Record<SettingsTabs, TitleKey>> = {
  [SettingsTabs.About]: ['setting', 'tab.about'],
  [SettingsTabs.Advanced]: ['setting', 'tab.advanced'],
  [SettingsTabs.APIKey]: ['setting', 'tab.apikey'],
  [SettingsTabs.Appearance]: ['setting', 'tab.appearance'],
  [SettingsTabs.Billing]: ['subscription', 'tab.billing'],
  [SettingsTabs.Connector]: ['setting', 'tab.connector'],
  [SettingsTabs.Creds]: ['setting', 'tab.creds'],
  [SettingsTabs.Credits]: ['subscription', 'tab.credits'],
  [SettingsTabs.Devices]: ['setting', 'devices.title'],
  [SettingsTabs.Environments]: ['setting', 'tab.environments'],
  [SettingsTabs.Hotkey]: ['setting', 'tab.hotkey'],
  [SettingsTabs.Integrations]: ['setting', 'tab.integrations'],
  [SettingsTabs.Labels]: ['setting', 'tab.labels'],
  // Labs has no `setting:tab.*` entry — the nav label comes from the labs namespace.
  [SettingsTabs.Labs]: ['labs', 'title'],
  [SettingsTabs.Memory]: ['setting', 'tab.memory'],
  [SettingsTabs.Messenger]: ['setting', 'tab.messenger'],
  [SettingsTabs.Notification]: ['setting', 'tab.notification'],
  [SettingsTabs.OAuthApps]: ['auth', 'tab.oauthApps'],
  [SettingsTabs.Plans]: ['subscription', 'tab.plans'],
  [SettingsTabs.Profile]: ['auth', 'profile.title'],
  [SettingsTabs.Proxy]: ['setting', 'tab.proxy'],
  [SettingsTabs.Referral]: ['subscription', 'tab.referral'],
  [SettingsTabs.ServiceModel]: ['setting', 'tab.serviceModel'],
  [SettingsTabs.Stats]: ['auth', 'tab.stats'],
  [SettingsTabs.Storage]: ['setting', 'tab.storage'],
  [SettingsTabs.SystemTools]: ['setting', 'tab.systemTools'],
  [SettingsTabs.Tools]: ['setting', 'tab.tools'],
  [SettingsTabs.Trash]: ['setting', 'tab.trash'],
  [SettingsTabs.Usage]: ['setting', 'tab.usage'],
};

const TITLE_NAMESPACES = ['auth', 'labs', 'setting', 'subscription'] as const;

/** The header title of `tab`, or `undefined` until its namespace has loaded. */
export const useSettingsTabTitle = (tab: string | undefined): string | undefined => {
  const { t, ready } = useTranslation(TITLE_NAMESPACES);
  const entry = tab ? SETTINGS_TAB_TITLE_KEYS[tab as SettingsTabs] : undefined;
  if (!entry || !ready) return undefined;

  const [ns, key] = entry;
  // Keys come from the table above, so the typed overloads would only recurse.
  return (t as (key: string, options: { ns: string }) => string)(key, { ns });
};
