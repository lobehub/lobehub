import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { type LucideIcon } from 'lucide-react';
import {
  Brain,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  EthernetPort,
  Gift,
  Image as ImageIcon,
  Info,
  KeyboardIcon,
  KeyIcon,
  Map,
  Palette as PaletteIcon,
  PieChart,
  UserCircle,
} from 'lucide-react';

import { type ContextType, type MenuContext } from '../types';

export interface ContextCommand {
  icon: LucideIcon;
  keywords: string[];
  keywordsKey?: string;
  label: string;
  labelKey?: string;
  labelNamespace?: 'setting' | 'auth' | 'subscription';
  path: string;
  subPath: string;
}

/**
 * Map of context types to their available commands
 */
export const CONTEXT_COMMANDS: Record<ContextType, ContextCommand[]> = {
  agent: [],
  group: [],
  page: [],
  painting: [],
  resource: [],
  settings: [
    {
      icon: UserCircle,
      keywords: ['profile', 'user', 'account', 'personal'],
      keywordsKey: 'cmdk.keywords.profile',
      label: 'Profile',
      labelKey: 'tab.profile',
      labelNamespace: 'auth',
      path: '/settings/profile',
      subPath: 'profile',
    },
    {
      icon: PaletteIcon,
      keywords: ['common', 'appearance', 'theme', 'display'],
      keywordsKey: 'cmdk.keywords.appearance',
      label: 'Appearance',
      labelKey: 'tab.common',
      labelNamespace: 'setting',
      path: '/settings/common',
      subPath: 'common',
    },
    {
      icon: Brain,
      keywords: ['provider', 'llm', 'model', 'ai'],
      keywordsKey: 'cmdk.keywords.provider',
      label: 'Model Provider',
      labelKey: 'tab.provider',
      labelNamespace: 'setting',
      path: '/settings/provider',
      subPath: 'provider',
    },
    {
      icon: KeyboardIcon,
      keywords: ['hotkey', 'shortcut', 'keyboard'],
      keywordsKey: 'cmdk.keywords.hotkey',
      label: 'Hotkeys',
      labelKey: 'tab.hotkey',
      labelNamespace: 'setting',
      path: '/settings/hotkey',
      subPath: 'hotkey',
    },
    {
      icon: ImageIcon,
      keywords: ['image', 'picture', 'photo'],
      keywordsKey: 'cmdk.keywords.image',
      label: 'Image Settings',
      labelKey: 'tab.image',
      labelNamespace: 'setting',
      path: '/settings/image',
      subPath: 'image',
    },
    ...(isDesktop
      ? [
          {
            icon: EthernetPort,
            keywords: ['proxy', 'network', 'connection'],
            keywordsKey: 'cmdk.keywords.proxy',
            label: 'Proxy',
            labelKey: 'tab.proxy',
            labelNamespace: 'setting' as const,
            path: '/settings/proxy',
            subPath: 'proxy',
          },
        ]
      : []),
    {
      icon: ChartColumnBigIcon,
      keywords: ['stats', 'statistics', 'analytics'],
      keywordsKey: 'cmdk.keywords.stats',
      label: 'Statistics',
      labelKey: 'tab.stats',
      labelNamespace: 'auth',
      path: '/settings/stats',
      subPath: 'stats',
    },
    {
      icon: KeyIcon,
      keywords: ['apikey', 'api', 'key', 'token'],
      keywordsKey: 'cmdk.keywords.apikey',
      label: 'API Keys',
      labelKey: 'tab.apikey',
      labelNamespace: 'auth',
      path: '/settings/apikey',
      subPath: 'apikey',
    },
    {
      icon: Info,
      keywords: ['about', 'version', 'info'],
      keywordsKey: 'cmdk.keywords.about',
      label: 'About',
      labelKey: 'tab.about',
      labelNamespace: 'setting',
      path: '/settings/about',
      subPath: 'about',
    },
    ...(ENABLE_BUSINESS_FEATURES
      ? [
          {
            icon: Map,
            keywords: ['subscription', 'plan', 'upgrade', 'pricing'],
            keywordsKey: 'cmdk.keywords.plans',
            label: 'Subscription Plans',
            labelKey: 'tab.plans',
            labelNamespace: 'subscription' as const,
            path: '/settings/plans',
            subPath: 'plans',
          },
          {
            icon: Coins,
            keywords: ['funds', 'balance', 'credit', 'money'],
            keywordsKey: 'cmdk.keywords.funds',
            label: 'Funds',
            labelKey: 'tab.funds',
            labelNamespace: 'subscription' as const,
            path: '/settings/funds',
            subPath: 'funds',
          },
          {
            icon: PieChart,
            keywords: ['usage', 'statistics', 'consumption', 'quota'],
            keywordsKey: 'cmdk.keywords.usage',
            label: 'Usage',
            labelKey: 'tab.usage',
            labelNamespace: 'subscription' as const,
            path: '/settings/usage',
            subPath: 'usage',
          },
          {
            icon: CreditCard,
            keywords: ['billing', 'payment', 'invoice', 'transaction'],
            keywordsKey: 'cmdk.keywords.billing',
            label: 'Billing',
            labelKey: 'tab.billing',
            labelNamespace: 'subscription' as const,
            path: '/settings/billing',
            subPath: 'billing',
          },
          {
            icon: Gift,
            keywords: ['referral', 'rewards', 'invite', 'bonus'],
            keywordsKey: 'cmdk.keywords.referral',
            label: 'Referral Rewards',
            labelKey: 'tab.referral',
            labelNamespace: 'subscription' as const,
            path: '/settings/referral',
            subPath: 'referral',
          },
        ]
      : []),
  ],
};

/**
 * Get context-specific commands based on context type and current sub-path
 * Filters out the current page from the list
 */
export const getContextCommands = (
  contextType: MenuContext,
  currentSubPath?: string,
): ContextCommand[] => {
  const commands = CONTEXT_COMMANDS[contextType as ContextType] || [];

  // Filter out the current page
  return commands.filter((cmd) => cmd.subPath !== currentSubPath);
};
