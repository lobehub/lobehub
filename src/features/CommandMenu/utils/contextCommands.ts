import type { LucideIcon } from 'lucide-react';
import {
  Brain,
  ChartColumnBigIcon,
  EthernetPort,
  Image as ImageIcon,
  Info,
  KeyIcon,
  KeyboardIcon,
  Palette as PaletteIcon,
  UserCircle,
} from 'lucide-react';

import type { ContextType, MenuContext } from '../types';

export interface ContextCommand {
  icon: LucideIcon;
  keywords: string[];
  label: string;
  labelKey?: string; // i18n key for the label
  labelNamespace?: 'setting' | 'auth'; // i18n namespace for the label
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
      label: 'Profile',
      labelKey: 'tab.profile',
      labelNamespace: 'auth',
      path: '/settings/profile',
      subPath: 'profile',
    },
    {
      icon: PaletteIcon,
      keywords: ['common', 'appearance', 'theme', 'display'],
      label: 'Appearance',
      labelKey: 'tab.common',
      labelNamespace: 'setting',
      path: '/settings/common',
      subPath: 'common',
    },
    {
      icon: Brain,
      keywords: ['provider', 'llm', 'model', 'ai'],
      label: 'Model Provider',
      labelKey: 'tab.provider',
      labelNamespace: 'setting',
      path: '/settings/provider',
      subPath: 'provider',
    },
    {
      icon: KeyboardIcon,
      keywords: ['hotkey', 'shortcut', 'keyboard'],
      label: 'Hotkeys',
      labelKey: 'tab.hotkey',
      labelNamespace: 'setting',
      path: '/settings/hotkey',
      subPath: 'hotkey',
    },
    {
      icon: ImageIcon,
      keywords: ['image', 'picture', 'photo'],
      label: 'Image Settings',
      labelKey: 'tab.image',
      labelNamespace: 'setting',
      path: '/settings/image',
      subPath: 'image',
    },
    {
      icon: EthernetPort,
      keywords: ['proxy', 'network', 'connection'],
      label: 'Proxy',
      labelKey: 'tab.proxy',
      labelNamespace: 'setting',
      path: '/settings/proxy',
      subPath: 'proxy',
    },
    {
      icon: ChartColumnBigIcon,
      keywords: ['stats', 'statistics', 'analytics'],
      label: 'Statistics',
      labelKey: 'tab.stats',
      labelNamespace: 'auth',
      path: '/settings/stats',
      subPath: 'stats',
    },
    {
      icon: KeyIcon,
      keywords: ['apikey', 'api', 'key', 'token'],
      label: 'API Keys',
      labelKey: 'tab.apikey',
      labelNamespace: 'auth',
      path: '/settings/apikey',
      subPath: 'apikey',
    },
    {
      icon: Info,
      keywords: ['about', 'version', 'info'],
      label: 'About',
      labelKey: 'tab.about',
      labelNamespace: 'setting',
      path: '/settings/about',
      subPath: 'about',
    },
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
