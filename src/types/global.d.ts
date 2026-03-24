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
    __DEBUG_PROXY__: boolean | undefined;
    __editor?: IEditor;
    /** Dev-only: Zustand store snapshots via `getState()` keyed by store name */
    __LOBE_STORES?: Record<string, () => unknown>;
    __SERVER_CONFIG__: SPAServerConfig | undefined;
    lobeEnv?: {
      darwinMajorVersion?: number;
      isMacTahoe?: boolean;
      platform?: NodeJS.Platform;
    };
  }

  /** Vite define: running in CI environment (e.g. CI=true) */
  const __CI__: boolean;

  /** Vite define: development mode (NODE_ENV !== 'production') */
  const __DEV__: boolean;

  /** Vite define: current bundle is mobile variant */
  const __MOBILE__: boolean;

  /** Vite define: current bundle is Electron desktop variant */
  const __ELECTRON__: boolean | undefined;

  /** Vite define: desktop app version injected by electron-vite renderer build */
  const __MAIN_VERSION__: string;
}
