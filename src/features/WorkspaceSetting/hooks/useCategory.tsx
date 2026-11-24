import { isDesktop } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import {
  AppWindowIcon,
  BellIcon,
  Brain,
  BrainCircuit,
  Building2,
  ChartColumnBigIcon,
  ChartPieIcon,
  Coins,
  ContainerIcon,
  CreditCard,
  Database,
  EllipsisIcon,
  EthernetPort,
  FlaskConical,
  GaugeIcon,
  Gift,
  HandCoins,
  Info,
  KeyboardIcon,
  KeyIcon,
  Map,
  MessagesSquareIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  ScrollText,
  Sparkles,
  TagIcon,
  TerminalSquare,
  Trash2,
  Users,
  UsersRound,
  WebhookIcon,
  ZapIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SettingsScope } from '@/features/SettingsSwitch/settingsScope';
import { usePermission } from '@/hooks/usePermission';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { SettingsTabs } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, userProfileSelectors } from '@/store/user/selectors';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

export enum WorkspaceSettingsGroupKey {
  Account = 'account',
  Admin = 'admin',
  Agent = 'agent',
  Connection = 'connection',
  Data = 'data',
  General = 'general',
  Resource = 'resource',
  Subscription = 'subscription',
  System = 'system',
}

/**
 * Account tabs that only exist as personal pages. The workspace account set
 * still lists them so the set is the same in every space; they open the
 * personal page through `href`.
 */
export type PersonalOnlyAccountTab =
  | SettingsTabs.Notification
  | SettingsTabs.Memory
  | SettingsTabs.Proxy
  | SettingsTabs.Referral
  | SettingsTabs.SystemTools;

export interface WorkspaceSettingCategoryItem {
  /** Set for a personal-only account tab: the personal page it opens. */
  href?: string;
  icon: any;
  key: WorkspaceSettingsTabs | PersonalOnlyAccountTab;
  label: string;
}

export interface WorkspaceSettingCategoryGroup {
  items: WorkspaceSettingCategoryItem[];
  key: WorkspaceSettingsGroupKey;
  /** Account settings follow the user; space settings belong to this workspace. */
  scope: SettingsScope;
  title: string;
}

export const useWorkspaceSettingCategory = (): WorkspaceSettingCategoryGroup[] => {
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tLabs } = useTranslation('labs');
  const { t: tSubscription } = useTranslation('subscription');
  const { allowed: canManageWorkspace } = usePermission('manage_settings');
  const { allowed: canViewBilling } = usePermission('view_billing');
  // API keys act as the member who issued them, so the tab follows the same
  // member-level gate the server enforces: `API_KEY_*` is granted from Member
  // up, never to Viewer. Without this the tab leads to a list request that
  // immediately 403s.
  const { allowed: canCreateContent } = usePermission('create_content');
  const enableOAuthApps = useUserStore(labPreferSelectors.enableOAuthApps);
  const { hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const enableWebhook = useServerConfigStore(serverConfigSelectors.enableWebhook);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const [avatar, username] = useUserStore((s) => [
    userProfileSelectors.userAvatar(s),
    userProfileSelectors.nickName(s),
  ]);
  const remoteServerUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);

  const avatarUrl = useMemo(() => {
    if (!avatar) return undefined;
    if (isDesktop && avatar.startsWith('/') && remoteServerUrl) {
      return remoteServerUrl + avatar;
    }
    return avatar;
  }, [avatar, remoteServerUrl]);

  return useMemo(
    () =>
      [
        // ── Account settings (profile / appearance / hotkeys / conversation)
        // follow the user, not the workspace. They are mirrored under the
        // workspace prefix so opening them never leaves the workspace; the
        // pages are the personal ones. The sidebar shows them as their own set.
        {
          items: [
            {
              icon: avatarUrl ? (
                <Avatar avatar={avatarUrl} shape={'square'} size={26} />
              ) : undefined,
              key: WorkspaceSettingsTabs.Profile,
              label: username || tAuth('tab.profile'),
            },
            {
              icon: PaletteIcon,
              key: WorkspaceSettingsTabs.Appearance,
              label: t('tab.appearance'),
            },
            {
              icon: KeyboardIcon,
              key: WorkspaceSettingsTabs.Hotkey,
              label: t('tab.hotkey'),
            },
            // Conversation preferences (reply language, chat assist, send key…)
            // act on the member's own chat surface, so every role configures
            // them here — the workspace Service Model page stays admin-only.
            {
              icon: MessagesSquareIcon,
              key: WorkspaceSettingsTabs.Conversation,
              label: t('tab.conversation'),
            },
            // Notification preferences, memory and referral exist only as
            // personal pages; listing them keeps the account set the same in
            // every space. The workspace's own Notifications tab stays in the
            // Workspace group.
            (enableBusinessFeatures || isDesktop) && {
              href: `/settings/${SettingsTabs.Notification}`,
              icon: BellIcon,
              key: SettingsTabs.Notification,
              label: t('tab.notification'),
            },
            {
              href: `/settings/${SettingsTabs.Memory}`,
              icon: BrainCircuit,
              key: SettingsTabs.Memory,
              label: t('tab.memory'),
            },
            enableBusinessFeatures && {
              href: `/settings/${SettingsTabs.Referral}`,
              icon: Gift,
              key: SettingsTabs.Referral,
              label: tSubscription('tab.referral'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Account,
          scope: 'account',
          title: t('group.profile'),
        },
        {
          items: [
            {
              icon: Building2,
              key: WorkspaceSettingsTabs.General,
              label: t('workspaceSetting.tab.general'),
            },
            {
              icon: Users,
              key: WorkspaceSettingsTabs.Members,
              label: t('workspaceSetting.tab.members'),
            },
            {
              icon: UsersRound,
              key: WorkspaceSettingsTabs.Teams,
              label: t('workspaceSetting.tab.teams'),
            },
            {
              icon: BellIcon,
              key: WorkspaceSettingsTabs.Notification,
              label: t('tab.notification'),
            },
            {
              icon: ChartColumnBigIcon,
              key: WorkspaceSettingsTabs.Stats,
              label: tAuth('tab.stats'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.General,
          scope: 'space',
          title: t('workspaceSetting.group.workspace'),
        },
        {
          items: [
            {
              icon: Map,
              key: WorkspaceSettingsTabs.Plans,
              label: tSubscription('tab.plans'),
            },
            {
              icon: ChartPieIcon,
              key: WorkspaceSettingsTabs.Usage,
              label: t('tab.usage'),
            },
            // Credits / Billing are readable by Admin-or-higher; the pages
            // themselves keep the money-moving controls (top-up, payment
            // methods, plan changes) behind the narrower subscription gate.
            canViewBilling && {
              icon: Coins,
              key: WorkspaceSettingsTabs.Credits,
              label: tSubscription('tab.credits'),
            },
            // Spend governance (budget pools + member caps) — admin task,
            // same visibility gate as the other money pages.
            canViewBilling && {
              icon: HandCoins,
              key: WorkspaceSettingsTabs.Budget,
              label: tSubscription('tab.budget'),
            },
            canViewBilling && {
              icon: CreditCard,
              key: WorkspaceSettingsTabs.Billing,
              label: tSubscription('tab.billing'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Subscription,
          scope: 'space',
          title: t('group.subscription'),
        },
        {
          items: [
            // AI provider config (keys/endpoints) is shared workspace infra —
            // Admin-or-higher, hidden from members entirely.
            canManageWorkspace && {
              icon: Brain,
              key: WorkspaceSettingsTabs.Provider,
              label: t('tab.provider'),
            },
            // Service-model preferences steer the shared workspace model
            // policy — Admin-or-higher, hidden from members like Provider.
            canManageWorkspace && {
              icon: Sparkles,
              key: WorkspaceSettingsTabs.ServiceModel,
              label: t('tab.serviceModel'),
            },
            // Label registry is readable by everyone; the page itself keeps
            // management actions behind the admin gate (disabled, not hidden).
            {
              icon: TagIcon,
              key: WorkspaceSettingsTabs.Labels,
              label: t('workspaceSetting.tab.labels'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Agent,
          scope: 'space',
          title: t('workspaceSetting.group.agent'),
        },
        enableWebhook && {
          items: [
            // Every member sees the workspace's event subscriptions, so it is
            // clear what fires the shared agents; managing one is per row.
            {
              icon: ZapIcon,
              key: WorkspaceSettingsTabs.Automations,
              label: t('tab.automations'),
            },
            // The workspace's agents' webhooks; made on each agent's page, managed here too.
            {
              icon: WebhookIcon,
              key: WorkspaceSettingsTabs.Webhooks,
              label: t('tab.webhooks'),
            },
          ] as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Connection,
          scope: 'space',
          title: t('group.connection'),
        },
        // What the workspace's agents run on and spend: machines, coding-agent
        // subscriptions, code environments and the drive. Each item keeps its
        // own gate; the group only puts the shared capacity in one place.
        {
          items: [
            {
              icon: MonitorSmartphoneIcon,
              key: WorkspaceSettingsTabs.Devices,
              label: t('tab.devices'),
            },
            // The coding-agent accounts are shared capacity every agent routes
            // onto, so taking one in or out of rotation is an admin decision.
            canManageWorkspace && {
              icon: GaugeIcon,
              key: WorkspaceSettingsTabs.SubscriptionAccounts,
              label: t('tab.subscriptionAccounts'),
            },
            // Environments & Vault, always there: what a run starts from and
            // the secrets it reads, in one place. An environment is a definition,
            // written down before anything runs it, so it needs no drive.
            {
              icon: ContainerIcon,
              key: WorkspaceSettingsTabs.Environments,
              label: t('tab.environmentsAndCreds'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Resource,
          scope: 'space',
          title: t('group.resource'),
        },
        // The Admin group is available to Admin and Owner.
        canManageWorkspace && {
          items: [
            {
              icon: Database,
              key: WorkspaceSettingsTabs.Storage,
              label: t('tab.storage'),
            },
            {
              icon: ScrollText,
              key: WorkspaceSettingsTabs.AuditLog,
              label: t('workspaceSetting.tab.auditLog'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Admin,
          scope: 'space',
          title: t('workspaceSetting.group.admin'),
        },
        // What the workspace stores and the keys that act on it. Trash is
        // visible to every role — the server shows owners the whole bin and
        // members only what they deleted. API Key keeps its member-level gate.
        {
          items: [
            {
              icon: Trash2,
              key: WorkspaceSettingsTabs.Trash,
              label: t('tab.trash'),
            },
            canCreateContent && {
              icon: KeyIcon,
              key: WorkspaceSettingsTabs.APIKey,
              label: tAuth('tab.apikey'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Data,
          scope: 'space',
          title: t('group.data'),
        },
        // App preferences of the account set — low-frequency, so the sidebar
        // starts it collapsed. Advanced and Labs are user preferences; OAuth
        // apps keep their Labs gate.
        {
          items: [
            isDesktop && {
              href: `/settings/${SettingsTabs.Proxy}`,
              icon: EthernetPort,
              key: SettingsTabs.Proxy,
              label: t('tab.proxy'),
            },
            isDesktop && {
              href: `/settings/${SettingsTabs.SystemTools}`,
              icon: TerminalSquare,
              key: SettingsTabs.SystemTools,
              label: t('tab.systemTools'),
            },
            {
              icon: EllipsisIcon,
              key: WorkspaceSettingsTabs.Advanced,
              label: t('tab.advanced'),
            },
            enableOAuthApps && {
              icon: AppWindowIcon,
              key: WorkspaceSettingsTabs.OAuthApps,
              label: tAuth('tab.oauthApps'),
            },
            {
              icon: FlaskConical,
              key: WorkspaceSettingsTabs.Labs,
              label: tLabs('title'),
            },
            !hideDocs && {
              icon: Info,
              key: WorkspaceSettingsTabs.About,
              label: t('tab.about'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.System,
          scope: 'account',
          title: t('group.systemDeveloper'),
        },
      ].filter(Boolean) as WorkspaceSettingCategoryGroup[],
    [
      t,
      tAuth,
      tLabs,
      tSubscription,
      enableOAuthApps,
      canManageWorkspace,
      canViewBilling,
      canCreateContent,
      hideDocs,
      enableWebhook,
      enableBusinessFeatures,
      avatarUrl,
      username,
    ],
  );
};
