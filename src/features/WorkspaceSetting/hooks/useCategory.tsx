import { SkillsIcon } from '@lobehub/ui/icons';
import {
  Brain,
  Building2,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  KeyIcon,
  KeyRound,
  Map,
  MonitorSmartphoneIcon,
  Sparkles,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import { useShowWorkspaceApiKey } from '@/business/client/hooks/useShowWorkspaceApiKey';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

export enum WorkspaceSettingsGroupKey {
  Admin = 'admin',
  Agent = 'agent',
  General = 'general',
  Subscription = 'subscription',
}

export interface WorkspaceSettingCategoryItem {
  icon: any;
  key: WorkspaceSettingsTabs;
  label: string;
}

export interface WorkspaceSettingCategoryGroup {
  items: WorkspaceSettingCategoryItem[];
  key: WorkspaceSettingsGroupKey;
  title: string;
}

export const useWorkspaceSettingCategory = (): WorkspaceSettingCategoryGroup[] => {
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tSubscription } = useTranslation('subscription');
  const showApiKey = useShowWorkspaceApiKey();
  const isOwner = useIsWorkspaceOwner();

  return useMemo(
    () =>
      [
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
              icon: MonitorSmartphoneIcon,
              key: WorkspaceSettingsTabs.Devices,
              label: t('tab.devices'),
            },
            {
              icon: ChartColumnBigIcon,
              key: WorkspaceSettingsTabs.Stats,
              label: tAuth('tab.stats'),
            },
          ],
          key: WorkspaceSettingsGroupKey.General,
          title: t('workspaceSetting.group.general'),
        },
        {
          items: [
            {
              icon: Map,
              key: WorkspaceSettingsTabs.Plans,
              label: tSubscription('tab.plans'),
            },
            {
              icon: ChartColumnBigIcon,
              key: WorkspaceSettingsTabs.Usage,
              label: t('tab.usage'),
            },
            {
              icon: Coins,
              key: WorkspaceSettingsTabs.Credits,
              label: tSubscription('tab.credits'),
            },
            {
              icon: CreditCard,
              key: WorkspaceSettingsTabs.Billing,
              label: tSubscription('tab.billing'),
            },
          ],
          key: WorkspaceSettingsGroupKey.Subscription,
          title: t('group.subscription'),
        },
        {
          items: [
            {
              icon: Brain,
              key: WorkspaceSettingsTabs.Provider,
              label: t('tab.provider'),
            },
            {
              icon: Sparkles,
              key: WorkspaceSettingsTabs.ServiceModel,
              label: t('tab.serviceModel'),
            },
            {
              icon: SkillsIcon,
              key: WorkspaceSettingsTabs.Skill,
              label: t('workspaceSetting.tab.skill'),
            },
            {
              icon: KeyRound,
              key: WorkspaceSettingsTabs.Creds,
              label: t('tab.creds'),
            },
            // Messenger (chat platform) is intentionally omitted from workspace
            // settings: the System Bot binding is a per-user/personal identity
            // (the link is owned by `userId`, not the workspace), and reaching a
            // workspace's agents happens via the scope selector on the *personal*
            // Messenger page. There is nothing workspace-level to configure here.
          ],
          key: WorkspaceSettingsGroupKey.Agent,
          title: t('workspaceSetting.group.agent'),
        },
        // The Admin group (workspace storage / API keys) is owner-only — managing
        // shared infra is an owner action.
        isOwner && {
          items: [
            {
              icon: Database,
              key: WorkspaceSettingsTabs.Storage,
              label: t('tab.storage'),
            },
            showApiKey && {
              icon: KeyIcon,
              key: WorkspaceSettingsTabs.APIKey,
              label: tAuth('tab.apikey'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Admin,
          title: t('workspaceSetting.group.admin'),
        },
      ].filter(Boolean) as WorkspaceSettingCategoryGroup[],
    [t, tAuth, tSubscription, showApiKey, isOwner],
  );
};
