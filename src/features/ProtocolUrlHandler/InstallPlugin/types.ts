import { type McpInstallSchema } from '@lobechat/electron-client-ipc';

export enum PluginSource {
  CUSTOM = 'custom',
  MARKETPLACE = 'marketplace',
  OFFICIAL = 'official',
}

export interface McpInstallRequest {
  marketId?: string;
  pluginId: string;
  schema?: McpInstallSchema;
  source: string;
}

export interface BaseContentProps {
  installRequest: McpInstallRequest;
}

export interface ModalConfig {
  okText: string;
  title: string;
  width?: number;
}

// 可信的第三方市场列表
export const TRUSTED_MARKETPLACES = {
  higress: {
    description: 'Enterprise-grade MCP plugins for cloud-native applications',
    name: 'Higress Marketplace',
    website: 'https://higress.ai',
  },
  mcprouter: {
    description: 'Community-driven MCP plugin marketplace',
    name: 'MCPRouter',
    website: 'https://mcprouter.com',
  },
  smithery: {
    description: 'Professional MCP plugins and tools',
    name: 'Smithery',
    website: 'https://smithery.ai',
  },
} as const;

export type TrustedMarketplaceId = keyof typeof TRUSTED_MARKETPLACES;
