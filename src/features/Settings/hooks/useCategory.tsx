import { ENABLE_TOOL_CHANNEL_SETTINGS } from '@lobechat/business-const';
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
  ChartPieIcon,
  Coins,
  ContainerIcon,
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
  PlugIcon,
  Sparkles,
  TagIcon,
  TerminalSquare,
  Trash2,
  Wrench,
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
  Account = 'account',
  Agent = 'agent',
  Connection = 'connection',
  Resource = 'resource',
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

    // Account group — who the user is and how the app behaves for them.
    const accountItems: CategoryItem[] = [
      {
        icon: avatarUrl ? <Avatar avatar={avatarUrl} shape={'square'} size={26} /> : undefined,
        key: SettingsTabs.Profile,
        label: username || tAuth('tab.profile'),
      },
      {
        icon: PaletteIcon,
        key: SettingsTabs.Appearance,
        label: t('tab.appearance'),
      },
      !mobile && {
        icon: KeyboardIcon,
        key: SettingsTabs.Hotkey,
        label: t('tab.hotkey'),
      },
      (enableBusinessFeatures || isDesktop) && {
        icon: BellIcon,
        key: SettingsTabs.Notification,
        label: t('tab.notification'),
      },
      {
        icon: ChartColumnBigIcon,
        key: SettingsTabs.Stats,
        label: tAuth('tab.stats'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: accountItems,
      key: SettingsGroupKey.Account,
      title: t('group.profile'),
    });

    // Personal subscription / billing items sit right under the account they
    // belong to. Always shown when business features are enabled — workspace
    // settings live under a separate `/:workspaceSlug/settings/*` surface and
    // never share this sidebar.
    if (enableBusinessFeatures) {
      const subscriptionItems: CategoryItem[] = [
        { icon: Map, key: SettingsTabs.Plans, label: tSubscription('tab.plans') },
        { icon: ChartPieIcon, key: SettingsTabs.Usage, label: t('tab.usage') },
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

    // Agent group — which models an agent uses and what it can do.
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
      ENABLE_TOOL_CHANNEL_SETTINGS && {
        icon: Wrench,
        key: SettingsTabs.Tools,
        label: t('tab.tools'),
      },
      {
        icon: BrainCircuit,
        key: SettingsTabs.Memory,
        label: t('tab.memory'),
      },
      {
        icon: TagIcon,
        key: SettingsTabs.Labels,
        label: t('tab.labels'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: agentItems,
      key: SettingsGroupKey.Agent,
      title: t('group.aiConfig'),
    });

    // Connection group — the outside services agents can reach, whoever owns
    // the binding. Every entry here is already the user's own.
    const connectionItems: CategoryItem[] = [
      // The bots are LobeHub-operated: their credentials are only ever written
      // by the cloud admin, so a self-hosted deployment has nothing to bind to.
      enableBusinessFeatures && {
        icon: MessageCircleIcon,
        key: SettingsTabs.Messenger,
        label: t('tab.messenger'),
      },
      {
        icon: PlugIcon,
        key: SettingsTabs.Integrations,
        label: t('tab.integrations'),
      },
      {
        icon: Blocks,
        key: SettingsTabs.Connector,
        label: t('tab.connector'),
      },
      {
        icon: KeyRound,
        key: SettingsTabs.Creds,
        label: t('tab.creds'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: connectionItems,
      key: SettingsGroupKey.Connection,
      title: t('group.connection'),
    });

    // Resource group — where agents run.
    const resourceItems: CategoryItem[] = [
      {
        icon: MonitorSmartphoneIcon,
        key: SettingsTabs.Devices,
        label: t('tab.devices'),
      },
      // Always there: a code environment is a definition, written down before
      // anything runs it, and useful with or without a drive to run it on.
      {
        icon: ContainerIcon,
        key: SettingsTabs.Environments,
        label: t('tab.environments'),
      },
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
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: resourceItems,
      key: SettingsGroupKey.Resource,
      title: t('group.resource'),
    });

    // System & developer group — low-frequency, so the sidebar starts it
    // collapsed. API Key has a single home whichever flag turned it on.
    const systemItems: CategoryItem[] = [
      {
        icon: Database,
        key: SettingsTabs.Storage,
        label: t('tab.storage'),
      },
      {
        icon: Trash2,
        key: SettingsTabs.Trash,
        label: t('tab.trash'),
      },
      {
        icon: EllipsisIcon,
        key: SettingsTabs.Advanced,
        label: t('tab.advanced'),
      },
      (showApiKeyManage || isDevMode) && {
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
      !hideDocs && {
        icon: Info,
        key: SettingsTabs.About,
        label: t('tab.about'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: systemItems,
      key: SettingsGroupKey.System,
      title: t('group.systemDeveloper'),
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
