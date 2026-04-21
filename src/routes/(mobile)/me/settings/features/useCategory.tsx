import { SkillsIcon } from '@lobehub/ui/icons';
import {
  Brain,
  BrainCircuit,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  EllipsisIcon,
  Gift,
  Info,
  KeyIcon,
  KeyRound,
  Map,
  PaletteIcon,
  Sparkles,
  UserCircle,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { type CellProps } from '@/components/Cell';
import { SettingsTabs } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

export enum SettingsGroupKey {
  Agent = 'agent',
  General = 'general',
  Subscription = 'subscription',
  System = 'system',
}

export interface CategoryItem extends Omit<CellProps, 'type'> {
  key: SettingsTabs;
}

export interface CategoryGroup {
  items: CategoryItem[];
  key: SettingsGroupKey;
  title: string;
}

export const useCategory = (): CategoryGroup[] => {
  const navigate = useNavigate();
  const { t } = useTranslation(['setting', 'auth', 'subscription']);
  const { hideDocs, showApiKeyManage } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  return useMemo(() => {
    const navigateTo = (key: SettingsTabs) =>
      navigate(key === SettingsTabs.Provider ? '/settings/provider/all' : `/settings/${key}`);

    const makeItem = (item: Omit<CategoryItem, 'onClick'>): CategoryItem => ({
      ...item,
      onClick: () => navigateTo(item.key),
    });

    const general: CategoryItem[] = [
      makeItem({ icon: UserCircle, key: SettingsTabs.Profile, label: t('auth:profile.title') }),
      makeItem({ icon: ChartColumnBigIcon, key: SettingsTabs.Stats, label: t('auth:tab.stats') }),
      makeItem({
        icon: PaletteIcon,
        key: SettingsTabs.Appearance,
        label: t('setting:tab.appearance'),
      }),
    ];

    const subscription: CategoryItem[] = enableBusinessFeatures
      ? [
          makeItem({ icon: Map, key: SettingsTabs.Plans, label: t('subscription:tab.plans') }),
          makeItem({
            icon: ChartColumnBigIcon,
            key: SettingsTabs.Usage,
            label: t('setting:tab.usage'),
          }),
          makeItem({
            icon: Coins,
            key: SettingsTabs.Credits,
            label: t('subscription:tab.credits'),
          }),
          makeItem({
            icon: CreditCard,
            key: SettingsTabs.Billing,
            label: t('subscription:tab.billing'),
          }),
          makeItem({
            icon: Gift,
            key: SettingsTabs.Referral,
            label: t('subscription:tab.referral'),
          }),
        ]
      : [];

    const agent: CategoryItem[] = [
      (!enableBusinessFeatures || isDevMode) &&
        makeItem({ icon: Brain, key: SettingsTabs.Provider, label: t('setting:tab.provider') }),
      makeItem({
        icon: Sparkles,
        key: SettingsTabs.ServiceModel,
        label: t('setting:tab.serviceModel'),
      }),
      makeItem({ icon: SkillsIcon, key: SettingsTabs.Skill, label: t('setting:tab.skill') }),
      makeItem({ icon: BrainCircuit, key: SettingsTabs.Memory, label: t('setting:tab.memory') }),
      makeItem({ icon: KeyRound, key: SettingsTabs.Creds, label: t('setting:tab.creds') }),
      showApiKeyManage &&
        makeItem({ icon: KeyIcon, key: SettingsTabs.APIKey, label: t('auth:tab.apikey') }),
    ].filter((item): item is CategoryItem => Boolean(item));

    const system: CategoryItem[] = [
      makeItem({ icon: Database, key: SettingsTabs.Storage, label: t('setting:tab.storage') }),
      isDevMode &&
        makeItem({ icon: KeyIcon, key: SettingsTabs.APIKey, label: t('auth:tab.apikey') }),
      makeItem({
        icon: EllipsisIcon,
        key: SettingsTabs.Advanced,
        label: t('setting:tab.advanced'),
      }),
      !hideDocs && makeItem({ icon: Info, key: SettingsTabs.About, label: t('setting:tab.about') }),
    ].filter((item): item is CategoryItem => Boolean(item));

    return [
      { items: general, key: SettingsGroupKey.General, title: t('setting:group.common') },
      {
        items: subscription,
        key: SettingsGroupKey.Subscription,
        title: t('setting:group.subscription'),
      },
      { items: agent, key: SettingsGroupKey.Agent, title: t('setting:group.aiConfig') },
      { items: system, key: SettingsGroupKey.System, title: t('setting:group.system') },
    ].filter((group) => group.items.length > 0);
  }, [t, enableBusinessFeatures, hideDocs, showApiKeyManage, isDevMode, navigate]);
};
