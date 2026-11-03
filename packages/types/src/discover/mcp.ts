import type { PluginItem, PluginListResponse } from '@lobehub/market-sdk';
import type { PluginItemDetail } from '@lobehub/market-types';

import type { DiscoverAssistantItem } from './assistants';

export enum McpCategory {
  All = 'all',
  Business = 'business',
  Developer = 'developer',
  Discover = 'discover',
  GamingEntertainment = 'gaming-entertainment',
  HealthWellness = 'health-wellness',
  Lifestyle = 'lifestyle',
  MediaGenerate = 'media-generate',
  News = 'news',
  Productivity = 'productivity',
  ScienceEducation = 'science-education',
  Social = 'social',
  StocksFinance = 'stocks-finance',
  Tools = 'tools',
  TravelTransport = 'travel-transport',
  Weather = 'weather',
  WebSearch = 'web-search',
}

export enum McpSorts {
  CreatedAt = 'createdAt',
  InstallCount = 'installCount',
  IsFeatured = 'isFeatured',
  IsValidated = 'isValidated',
  RatingCount = 'ratingCount',
  Recommended = 'recommended',
  UpdatedAt = 'updatedAt',
}

export enum McpNavKey {
  Agents = 'agents',
  Deployment = 'deployment',
  Overview = 'overview',
  Related = 'related',
  Schema = 'schema',
  Score = 'score',
  Settings = 'settings',
  Version = 'version',
}

export enum McpConnectionType {
  http = 'http',
  stdio = 'stdio',
}

export type DiscoverMcpItem = PluginItem;

export interface McpQueryParams {
  category?: string;
  connectionType?: McpConnectionType;
  locale?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: McpSorts;
}

export type McpListResponse = PluginListResponse;

export interface DiscoverMcpDetail extends PluginItemDetail {
  agents?: DiscoverAssistantItem[];
  haveCloudEndpoint?: boolean;
  isClaimed?: boolean;
  related: DiscoverMcpItem[];
}
