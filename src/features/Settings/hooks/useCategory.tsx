import { ENABLE_TOOL_CHANNEL_SETTINGS } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import {
  AppWindowIcon,
  BellIcon,
  Brain,
  BrainCircuit,
  ChartColumnBigIcon,
  ChartPieIcon,
  ContainerIcon,
  CreditCard,
  Database,
  EllipsisIcon,
  EthernetPort,
  FlaskConical,
  GaugeIcon,
  Gift,
  Info,
  KeyboardIcon,
  KeyIcon,
  Map,
  MessagesSquareIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  Sparkles,
  TagIcon,
  TerminalSquare,
  Trash2,
  WebhookIcon,
  Wrench,
  ZapIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SettingsScope } from '@/features/SettingsSwitch/settingsScope';
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

export enum SettingsGroupKey {
  Account = 'account',
  Agent = 'agent',
  Connection = 'connection',
  Data = 'data',
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
  /** Account settings follow the user; space settings belong to the personal space. */
  scope: SettingsScope;
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
  const enableOAuthApps = useUserStore(labPreferSelectors.enableOAuthApps);
  const enableWebhook = useServerConfigStore(serverConfigSelectors.enableWebhook);
  // Advanced holds gateway mode and desktop diagnostics; on the web without
  // gateway mode it would be an empty page.
  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);
  const showAdvanced = isDesktop || enableGatewayMode;

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

    // ── Account settings: who the user is and how the app behaves for them,
    // the same in every space.
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
      {
        icon: MessagesSquareIcon,
        key: SettingsTabs.Conversation,
        label: t('tab.conversation'),
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
        icon: BrainCircuit,
        key: SettingsTabs.Memory,
        label: t('tab.memory'),
      },
      enableBusinessFeatures && {
        icon: Gift,
        key: SettingsTabs.Referral,
        label: tSubscription('tab.referral'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: accountItems,
      key: SettingsGroupKey.Account,
      scope: 'account',
      title: t('group.profile'),
    });

    // Machine and app preferences — low-frequency, so the sidebar starts it
    // collapsed.
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
      showAdvanced && {
        icon: EllipsisIcon,
        key: SettingsTabs.Advanced,
        label: t('tab.advanced'),
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
      scope: 'account',
      title: t('group.systemDeveloper'),
    });

    // ── Personal space settings: what the personal space owns and spends.
    // Workspaces keep their own copy under `/:workspaceSlug/settings/*`.
    if (enableBusinessFeatures) {
      const subscriptionItems: CategoryItem[] = [
        { icon: Map, key: SettingsTabs.Plans, label: tSubscription('tab.plans') },
        // One entry for usage and balance: `/settings/credits` redirects into it.
        {
          icon: ChartPieIcon,
          key: SettingsTabs.Usage,
          label: tSubscription('tab.usage'),
        },
        { icon: CreditCard, key: SettingsTabs.Billing, label: tSubscription('tab.billing') },
      ];

      groups.push({
        items: subscriptionItems,
        key: SettingsGroupKey.Subscription,
        scope: 'space',
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
      ENABLE_TOOL_CHANNEL_SETTINGS && {
        icon: Wrench,
        key: SettingsTabs.Tools,
        label: t('tab.tools'),
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
      scope: 'space',
      title: t('group.aiConfig'),
    });

    // Connection group — the outside services the space's agents can reach.
    const connectionItems: CategoryItem[] = [
      // What connectors fire on their own: the event subscriptions agents made
      // through them. Connectors themselves are managed in the Marketplace.
      enableWebhook && {
        icon: ZapIcon,
        key: SettingsTabs.Automations,
        label: t('tab.automations'),
      },
      // URLs outside systems call to wake an agent; made on each agent's page, managed here too.
      enableWebhook && {
        icon: WebhookIcon,
        key: SettingsTabs.Webhooks,
        label: t('tab.webhooks'),
      },
    ].filter(Boolean) as CategoryItem[];

    // Every entry is conditional, so a self-hosted deployment may have none.
    if (connectionItems.length > 0)
      groups.push({
        items: connectionItems,
        key: SettingsGroupKey.Connection,
        scope: 'space',
        title: t('group.connection'),
      });

    // Resource group — where agents run.
    const resourceItems: CategoryItem[] = [
      {
        icon: MonitorSmartphoneIcon,
        key: SettingsTabs.Devices,
        label: t('tab.devices'),
      },
      // The coding-agent subscriptions this member's devices signed in to:
      // the capacity their agents are balanced onto.
      {
        icon: GaugeIcon,
        key: SettingsTabs.SubscriptionAccounts,
        label: t('tab.subscriptionAccounts'),
      },
      // Environments & Vault, always there: what a run starts from and
      // the secrets it reads, in one place. An environment is a definition,
      // written down before anything runs it, so it needs no drive.
      {
        icon: ContainerIcon,
        key: SettingsTabs.Environments,
        label: t('tab.environmentsAndCreds'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: resourceItems,
      key: SettingsGroupKey.Resource,
      scope: 'space',
      title: t('group.resource'),
    });

    // Data & developer group — what the space stores and spent, and the keys
    // that act on it. API Key has a single home whichever flag turned it on.
    const dataItems: CategoryItem[] = [
      {
        icon: ChartColumnBigIcon,
        key: SettingsTabs.Stats,
        label: tAuth('tab.stats'),
      },
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
      showApiKeyManage && {
        icon: KeyIcon,
        key: SettingsTabs.APIKey,
        label: tAuth('tab.apikey'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: dataItems,
      key: SettingsGroupKey.Data,
      scope: 'space',
      title: t('group.data'),
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
    enableOAuthApps,
    enableWebhook,
    showAdvanced,
    avatarUrl,
    username,
  ]);

  return categoryGroups;
};
