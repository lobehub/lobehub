import { DiscoverAssistantItem } from './assistants';

export * from './assistants';
export * from './mcp';
export * from './models';
export * from './plugins';
export * from './providers';

export enum DiscoverTab {
  Assistants = 'assistant',
  Home = 'home',
  Mcp = 'mcp',
  Models = 'model',
  Plugins = 'plugin',
  Providers = 'provider',
  User = 'user',
}

export type IdentifiersResponse = {
  identifier: string;
  lastModified: string;
}[];

export enum CacheTag {
  Assistants = 'assistants',
  Discover = 'discover',
  MCP = 'mcp',
  Models = 'models',
  Plugins = 'plugins',
  Providers = 'providers',
}

export enum CacheRevalidate {
  List = 3600,
  Details = 43_200,
}

/**
 * User profile information for discover pages
 */
export interface DiscoverUserInfo {
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
  description: string | null;
  displayName: string | null;
  followersCount?: number;
  followingCount?: number;
  id: number;
  namespace: string;
  socialLinks: {
    github?: string;
    twitter?: string;
    website?: string;
  } | null;
  type: string | null;
  userName: string | null;
}

/**
 * User profile with their published agents
 */
export interface DiscoverUserProfile {
  agents: DiscoverAssistantItem[];
  user: DiscoverUserInfo;
}
