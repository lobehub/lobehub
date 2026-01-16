import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import {
  Brain,
  BrainCircuit,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  EthernetPort,
  Gift,
  Image as ImageIcon,
  Info,
  KeyIcon,
  KeyboardIcon,
  Map,
  MessageSquareTextIcon,
  Mic2,
  PaletteIcon,
  PieChart,
  ShieldCheck,
  Sparkles,
  UserCircle,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { SettingsTabs } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

export enum SettingsGroupKey {
  AIConfig = 'ai-config',
  Account = 'account',
  Profile = 'profile',
  Subscription = 'subscription',
  System = 'system',
}

export interface CategoryItem {
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
  const { t: tSubscription } = useTranslation('subscription');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const { enableSTT, hideDocs, showAiImage, showApiKeyManage } =
    useServerConfigStore(featureFlagsSelectors);
  const [isLoginWithClerk, avatar, username] = useUserStore((s) => [
    authSelectors.isLoginWithClerk(s),
    userProfileSelectors.userAvatar(s),
    userProfileSelectors.nickName(s),
  ]);
  const remoteServerUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);

  // Process avatar URL for desktop environment
  const avatarUrl = useMemo(() => {
    if (!avatar) return undefined;
    if (isDesktop && avatar.startsWith('/') && remoteServerUrl) {
      return remoteServerUrl + avatar;
    }
    return avatar;
  }, [avatar, remoteServerUrl]);

  const categoryGroups: CategoryGroup[] = useMemo(() => {
    const groups: CategoryGroup[] = [];

    // 个人资料组 - Profile 相关设置
    const profileItems: CategoryItem[] = [
      {
        icon: avatarUrl ? <Avatar avatar={avatarUrl} shape={'square'} size={26} /> : UserCircle,
        key: SettingsTabs.Profile,
        label: username ? username : tAuth('tab.profile'),
      },
      isLoginWithClerk && {
        icon: ShieldCheck,
        key: SettingsTabs.Security,
        label: tAuth('tab.security'),
      },
      {
        icon: ChartColumnBigIcon,
        key: SettingsTabs.Stats,
        label: tAuth('tab.stats'),
      },
      showApiKeyManage && {
        icon: KeyIcon,
        key: SettingsTabs.APIKey,
        label: tAuth('tab.apikey'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: profileItems,
      key: SettingsGroupKey.Profile,
      title: t('group.profile'),
    });

    const subscriptionItems: CategoryItem[] = [
      {
        icon: Map,
        key: SettingsTabs.Plans,
        label: tSubscription('tab.plans'),
      },
      {
        icon: Coins,
        key: SettingsTabs.Funds,
        label: tSubscription('tab.funds'),
      },
      {
        icon: PieChart,
        key: SettingsTabs.Usage,
        label: tSubscription('tab.usage'),
      },
      {
        icon: CreditCard,
        key: SettingsTabs.Billing,
        label: tSubscription('tab.billing'),
      },
      {
        icon: Gift,
        key: SettingsTabs.Referral,
        label: tSubscription('tab.referral'),
      },
    ];

    if (ENABLE_BUSINESS_FEATURES) {
      groups.push({
        items: subscriptionItems,
        key: SettingsGroupKey.Subscription,
        title: t('group.subscription'),
      });
    }

    // 账号组 - 个人相关设置
    const commonItems: CategoryItem[] = [
      {
        icon: PaletteIcon,
        key: SettingsTabs.Common,
        label: t('tab.common'),
      },
      {
        icon: MessageSquareTextIcon,
        key: SettingsTabs.ChatAppearance,
        label: t('tab.chatAppearance'),
      },
      !mobile && {
        icon: KeyboardIcon,
        key: SettingsTabs.Hotkey,
        label: t('tab.hotkey'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: commonItems,
      key: SettingsGroupKey.Account,
      title: t('group.common'),
    });

    // AI 配置组 - AI 相关设置
    const aiConfigItems: CategoryItem[] = [
      {
        icon: Brain,
        key: SettingsTabs.Provider,
        label: t('tab.provider'),
      },
      {
        icon: Sparkles,
        key: SettingsTabs.Agent,
        label: t('tab.agent'),
      },
      {
        icon: BrainCircuit,
        key: SettingsTabs.Memory,
        label: t('tab.memory'),
      },
      showAiImage && {
        icon: ImageIcon,
        key: SettingsTabs.Image,
        label: t('tab.image'),
      },
      enableSTT && {
        icon: Mic2,
        key: SettingsTabs.TTS,
        label: t('tab.tts'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: aiConfigItems,
      key: SettingsGroupKey.AIConfig,
      title: t('group.aiConfig'),
    });

    // 系统组 - 系统相关设置
    const systemItems: CategoryItem[] = [
      isDesktop && {
        icon: EthernetPort,
        key: SettingsTabs.Proxy,
        label: t('tab.proxy'),
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

    return groups;
  }, [
    t,
    tAuth,
    enableSTT,
    hideDocs,
    mobile,
    showAiImage,
    showApiKeyManage,
    isLoginWithClerk,
    avatarUrl,
    username,
  ]);

  return categoryGroups;
};
