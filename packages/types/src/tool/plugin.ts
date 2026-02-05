import type { LobeChatPluginManifest, Meta } from '@lobehub/chat-plugin-sdk';

import type { LobeToolType } from './tool';

export type PluginManifestMap = Record<string, LobeChatPluginManifest>;

export interface CustomPluginMetadata {
  avatar?: string;
  description?: string;
  name?: string;
}

export interface CustomPluginParams {
  apiMode?: 'openapi' | 'simple';
  avatar?: string;
  description?: string;
  enableSettings?: boolean;
  /**
   * Klavis integration parameters
   */
  klavis?: {
    instanceId: string;
    isAuthenticated: boolean;
    oauthUrl?: string;
    serverName: string;
    serverUrl: string;
  };

  /* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
  manifestMode?: 'local' | 'url';
  manifestUrl?: string;
  /**
   * TODO: Temporary solution, needs major refactoring in the future
   */
  mcp?: {
    args?: string[];
    env?: Record<string, string>;
    command?: string;
    type: 'http' | 'stdio' | 'cloud';
    url?: string;
    cloudEndPoint?: string; // Cloud gateway endpoint for cloud type
    // Added authentication configuration support
    auth?: {
      type: 'none' | 'bearer' | 'oauth2';
      token?: string; // Bearer Token
      accessToken?: string; // OAuth2 Access Token
    };
    // Added headers configuration support
    headers?: Record<string, string>;
  };
  useProxy?: boolean;
}

export interface LobeToolCustomPlugin {
  customParams?: CustomPluginParams;
  identifier: string;
  manifest?: LobeChatPluginManifest;
  settings?: any;
  type: 'customPlugin';
}

export interface InstallPluginMeta extends Partial<Meta> {
  author?: string;
  createdAt?: string;
  homepage?: string;
  identifier: string;
  runtimeType?: 'mcp' | 'default' | 'markdown' | 'standalone' | undefined;
  type: LobeToolType;
}

export interface PluginInstallError {
  cause?: string;
  message: 'noManifest' | 'fetchError' | 'manifestInvalid' | 'urlError';
}
