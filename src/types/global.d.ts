import 'antd-style';

import { type IEditor } from '@lobehub/editor';
import { type LobeCustomStylish, type LobeCustomToken } from '@lobehub/ui';
import { type AntdToken } from 'antd-style/lib/types/theme';

import { type SPAServerConfig } from './spaServerConfig';

declare module 'antd-style' {
  export interface CustomToken extends LobeCustomToken {}

  export interface CustomStylish extends LobeCustomStylish {}
}

declare module 'styled-components' {
  export interface DefaultTheme extends AntdToken, LobeCustomToken {}
}

declare global {
  interface Window {
    __CHAT_STORE__?: any;
    __DEBUG_PROXY__: boolean | undefined;
    __editor?: IEditor;
    __SERVER_CONFIG__: SPAServerConfig | undefined;
    lobeEnv?: {
      darwinMajorVersion?: number;
      isMacTahoe?: boolean;
    };
  }

  /** Vite define: current bundle is mobile variant */
  const __MOBILE__: boolean;

  /** Vite define: current bundle is Electron desktop variant */
  const __ELECTRON__: boolean | undefined;
}
