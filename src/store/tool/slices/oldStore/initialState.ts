import { type DiscoverPluginItem } from '@/types/discover';

export type PluginInstallLoadingMap = Record<string, boolean | undefined>;

export enum PluginStoreTabs {
  Installed = 'installed',
  MCP = 'mcp',
  Plugin = 'old',
}

/* eslint-disable typescript-sort-keys/string-enum */
export enum PluginInstallStep {
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  FETCHING_MANIFEST = 'FETCHING_MANIFEST',
  INSTALLING_PLUGIN = 'INSTALLING_PLUGIN',
}

export interface PluginInstallProgress {
  // Error message
  error?: string;
  // 0-100
  progress: number;
  step: PluginInstallStep;
}

export type PluginInstallProgressMap = Record<string, PluginInstallProgress | undefined>;

export interface PluginStoreState {
  activePluginIdentifier?: string;
  currentPluginPage: number;
  displayMode: 'grid' | 'list';
  isPluginListInit?: boolean;

  listType: PluginStoreTabs;
  oldPluginItems: DiscoverPluginItem[];
  pluginInstallLoading: PluginInstallLoadingMap;
  pluginInstallProgress: PluginInstallProgressMap;
  pluginSearchKeywords?: string;
  pluginSearchLoading?: boolean;
  pluginTotalCount?: number;
}

export const initialPluginStoreState: PluginStoreState = {
  // Plugin list state management initial values
  currentPluginPage: 1,
  displayMode: 'grid',
  listType: PluginStoreTabs.MCP,
  oldPluginItems: [],
  pluginInstallLoading: {},
  pluginInstallProgress: {},
};
