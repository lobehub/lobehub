import { LobeChatPluginManifest, LobePluginType } from '@lobehub/chat-plugin-sdk';

import { CustomPluginParams } from './plugin';
import { LobeToolType } from './tool';

export interface LobeTool {
  customParams?: CustomPluginParams | null;
  identifier: string;
  manifest?: LobeChatPluginManifest | null;
  /**
   * use for runtime
   */
  runtimeType?: 'mcp' | 'default' | 'markdown' | 'standalone';
  settings?: any;
  // TODO: remove type and then make it required
  source?: LobeToolType;
  /**
   * need to be replaced with source
   * @deprecated
   */
  type: LobeToolType;
}

export type LobeToolRenderType = LobePluginType | 'builtin';

export * from './builtin';
export * from './crawler';
export * from './interpreter';
export * from './intervention';
export * from './plugin';
export * from './search';
export * from './tool';
