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
