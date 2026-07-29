import { isDesktop } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import {
  AppWindowIcon,
  BellIcon,
  Blocks,
  Brain,
  BrainCircuit,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  EllipsisIcon,
  EthernetPort,
  FlaskConical,
  Gift,
  Info,
  KeyboardIcon,
  KeyIcon,
  KeyRound,
  Map,
  MessageCircleIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { SettingsTabs } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

export enum SettingsGroupKey {
  Agent = 'agent',
  Developer = 'developer',
  General = 'general',
  Subscription = 'subscription',
  System = 'system',
}

export interface CategoryItem {
  /** Override the navigation URL. When omitted, Body derives the URL from `key`. */
  href?: string;
  icon: any;
  key: SettingsTabs;
  label: string;
}

export interface CategoryGroup {
  items: CategoryItem[];
  key: SettingsGroupKey;
  title: string;
}

export const useCategory = () => {
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tLabs } = useTranslation('labs');
  const { t: tSubscription } = useTranslation('subscription');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const { hideDocs, showApiKeyManage, showProvider } = useServerConfigStore(featureFlagsSelectors);
  const [avatar, username] = useUserStore((s) => [
    userProfileSelectors.userAvatar(s),
    userProfileSelectors.nickName(s),
  ]);
  const remoteServerUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const enableOAuthApps = useUserStore(labPreferSelectors.enableOAuthApps);

  const avatarUrl = useMemo(() => {
    if (!avatar) return undefined;
    if (isDesktop && avatar.startsWith('/') && remoteServerUrl) {
      return remoteServerUrl + avatar;
    }
    return avatar;
  }, [avatar, remoteServerUrl]);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const categoryGroups: CategoryGroup[] = useMemo(() => {
    const groups: CategoryGroup[] = [];

    // General group
    const generalItems: CategoryItem[] = [
      {
        icon: avatarUrl ? <Avatar avatar={avatarUrl} shape={'square'} size={26} /> : undefined,
        key: SettingsTabs.Profile,
        label: username || tAuth('tab.profile'),
      },
      {
        icon: ChartColumnBigIcon,
        key: SettingsTabs.Stats,
        label: tAuth('tab.stats'),
      },
      {
        icon: PaletteIcon,
        key: SettingsTabs.Appearance,
        label: t('tab.appearance'),
      },
      {
        icon: MonitorSmartphoneIcon,
        key: SettingsTabs.Devices,
        label: t('tab.devices'),
      },
      !mobile && {
        icon: KeyboardIcon,
        key: SettingsTabs.Hotkey,
        label: t('tab.hotkey'),
      },
      enableBusinessFeatures && {
        icon: BellIcon,
        key: SettingsTabs.Notification,
        label: t('tab.notification'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: generalItems,
      key: SettingsGroupKey.General,
      title: t('group.common'),
    });

    // Personal subscription / billing items. Always shown when business
    // features are enabled — workspace settings live under a separate
    // `/:workspaceSlug/settings/*` surface and never share this sidebar.
    if (enableBusinessFeatures) {
      const subscriptionItems: CategoryItem[] = [
        { icon: Map, key: SettingsTabs.Plans, label: tSubscription('tab.plans') },
        { icon: ChartColumnBigIcon, key: SettingsTabs.Usage, label: t('tab.usage') },
        { icon: Coins, key: SettingsTabs.Credits, label: tSubscription('tab.credits') },
        { icon: CreditCard, key: SettingsTabs.Billing, label: tSubscription('tab.billing') },
        { icon: Gift, key: SettingsTabs.Referral, label: tSubscription('tab.referral') },
      ];

      groups.push({
        items: subscriptionItems,
        key: SettingsGroupKey.Subscription,
        title: t('group.subscription'),
      });
    }

    // Agent group
    const agentItems: CategoryItem[] = [
      // Provider settings should not depend on Advanced tools: new users may need
      // non-LobeHub providers, and desktop users often bring their own API keys.
      showProvider && {
        icon: Brain,
        key: SettingsTabs.Provider,
        label: t('tab.provider'),
      },
      {
        icon: Sparkles,
        key: SettingsTabs.ServiceModel,
        label: t('tab.serviceModel'),
      },
      {
        icon: SkillsIcon,
        key: SettingsTabs.Skill,
        label: t('tab.skill'),
      },
      {
        icon: Blocks,
        key: SettingsTabs.Connector,
        label: t('tab.connector'),
      },
      {
        icon: BrainCircuit,
        key: SettingsTabs.Memory,
        label: t('tab.memory'),
      },
      {
        icon: KeyRound,
        key: SettingsTabs.Creds,
        label: t('tab.creds'),
      },
      showApiKeyManage && {
        icon: KeyIcon,
        key: SettingsTabs.APIKey,
        label: tAuth('tab.apikey'),
      },
      {
        icon: MessageCircleIcon,
        key: SettingsTabs.Messenger,
        label: t('tab.messenger'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: agentItems,
      key: SettingsGroupKey.Agent,
      title: t('group.aiConfig'),
    });

    // System group
    const systemItems: CategoryItem[] = [
      isDesktop && {
        icon: EthernetPort,
        key: SettingsTabs.Proxy,
        label: t('tab.proxy'),
      },
      isDesktop && {
        icon: TerminalSquare,
        key: SettingsTabs.SystemTools,
        label: t('tab.systemTools'),
      },
      {
        icon: Database,
        key: SettingsTabs.Storage,
        label: t('tab.storage'),
      },
      !hideDocs && {
        icon: Info,
        key: SettingsTabs.About,
        label: t('tab.about'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: systemItems,
      key: SettingsGroupKey.System,
      title: t('group.system'),
    });

    // Developer group. Advanced comes first, followed by the system-level API
    // Key (dev mode), OAuth apps (lab flag), and the Labs playground.
    const developerItems: CategoryItem[] = [
      {
        icon: EllipsisIcon,
        key: SettingsTabs.Advanced,
        label: t('tab.advanced'),
      },
      isDevMode && {
        icon: KeyIcon,
        key: SettingsTabs.APIKey,
        label: tAuth('tab.apikey'),
      },
      enableOAuthApps && {
        icon: AppWindowIcon,
        key: SettingsTabs.OAuthApps,
        label: tAuth('tab.oauthApps'),
      },
      {
        icon: FlaskConical,
        key: SettingsTabs.Labs,
        label: tLabs('title'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: developerItems,
      key: SettingsGroupKey.Developer,
      title: t('group.developer'),
    });

    return groups;
  }, [
    t,
    tAuth,
    tLabs,
    tSubscription,
    enableBusinessFeatures,
    hideDocs,
    mobile,
    showApiKeyManage,
    showProvider,
    isDevMode,
    enableOAuthApps,
    avatarUrl,
    username,
  ]);

  return categoryGroups;
};
