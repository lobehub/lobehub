import type { ToolManifest } from '../tool/manifest';

export enum PluginCategory {
  All = 'all',
  GamingEntertainment = 'gaming-entertainment',
  LifeStyle = 'lifestyle',
  MediaGenerate = 'media-generate',
  ScienceEducation = 'science-education',
  Social = 'social',
  StocksFinance = 'stocks-finance',
  Tools = 'tools',
  WebSearch = 'web-search',
}

export enum PluginNavKey {
  Settings = 'settings',
  Tools = 'tools',
}

export enum PluginSorts {
  CreatedAt = 'createdAt',
  Identifier = 'identifier',
  Title = 'title',
}

interface PluginMeta {
  avatar: string;
  description?: string;
  tags?: string[];
  title: string;
}

interface DiscoverPluginMeta {
  author: string;
  createdAt: string;
  homepage: string;
  identifier: string;
  manifest: string;
  meta: PluginMeta;
  schemaVersion: number;
}

export interface DiscoverPluginItem extends Omit<DiscoverPluginMeta, 'meta'>, PluginMeta {
  category?: PluginCategory;
}

export interface PluginQueryParams {
  category?: string;
  locale?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: PluginSorts;
}

export interface PluginListResponse {
  currentPage: number;
  items: DiscoverPluginItem[];
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/**
 * Plugin source types
 * - legacy: From old plugin list (_getPluginList)
 * - market: From Market SDK (getMcpDetail)
 * - builtin: From LobeHub builtin tools
 */
export type PluginSource = 'legacy' | 'market' | 'builtin';

export interface DiscoverPluginDetail extends Omit<DiscoverPluginItem, 'manifest'> {
  manifest?: ToolManifest | string;
  related: DiscoverPluginItem[];
  /**
   * Plugin source type
   */
  source?: PluginSource;
}
