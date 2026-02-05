import { isDesktop } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import {
  Blocks,
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
  KeyboardIcon,
  KeyIcon,
  Map,
  MessageSquareTextIcon,
  Mic2,
  PaletteIcon,
  PieChart,
  Sparkles,
  TerminalSquare,
  UserCircle,
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
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

export enum SettingsGroupKey {
  Account = 'account',
  AIConfig = 'ai-config',
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
  const [avatar, username] = useUserStore((s) => [
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
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const categoryGroups: CategoryGroup[] = useMemo(() => {
    const groups: CategoryGroup[] = [];

    // 个人资料组 - Profile 相关设置
    const profileItems: CategoryItem[] = [
      {
        icon: avatarUrl ? <Avatar avatar={avatarUrl} shape={'square'} size={26} /> : UserCircle,
        key: SettingsTabs.Profile,
        label: username ? username : tAuth('tab.profile'),
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

    if (enableBusinessFeatures) {
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
        icon: Blocks,
        key: SettingsTabs.Skill,
        label: t('tab.skill'),
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

    return groups;
  }, [
    t,
    tAuth,
    enableSTT,
    enableBusinessFeatures,
    hideDocs,
    mobile,
    showAiImage,
    showApiKeyManage,
    avatarUrl,
    username,
  ]);

  return categoryGroups;
};
