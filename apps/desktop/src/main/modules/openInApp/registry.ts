import type { OpenInAppId } from '@lobechat/electron-client-ipc';

export type DetectStrategy =
  | { paths: string[]; type: 'appBundle' }
  | { exeName: string; type: 'registryAppPaths' }
  | { binary: string; type: 'commandV' };

export type LaunchStrategy =
  | { appName: string; type: 'macOpenA' }
  | { type: 'macOpen' }
  | { args?: string[]; binary: string; type: 'exec' }
  | { type: 'shellOpenPath' };

export interface AppDescriptor {
  detect: Partial<Record<NodeJS.Platform, DetectStrategy>>;
  displayName: string;
  launch: Partial<Record<NodeJS.Platform, LaunchStrategy>>;
}

export const APP_REGISTRY: Record<OpenInAppId, AppDescriptor> = {
  vscode: {
    detect: {
      darwin: { paths: ['/Applications/Visual Studio Code.app'], type: 'appBundle' },
      linux: { binary: 'code', type: 'commandV' },
      win32: { exeName: 'Code.exe', type: 'registryAppPaths' },
    },
    displayName: 'VS Code',
    launch: {
      darwin: { appName: 'Visual Studio Code', type: 'macOpenA' },
      linux: { binary: 'code', type: 'exec' },
      win32: { binary: 'code', type: 'exec' },
    },
  },
  cursor: {
    detect: {
      darwin: { paths: ['/Applications/Cursor.app'], type: 'appBundle' },
      linux: { binary: 'cursor', type: 'commandV' },
      win32: { exeName: 'Cursor.exe', type: 'registryAppPaths' },
    },
    displayName: 'Cursor',
    launch: {
      darwin: { appName: 'Cursor', type: 'macOpenA' },
      linux: { binary: 'cursor', type: 'exec' },
      win32: { binary: 'cursor', type: 'exec' },
    },
  },
  zed: {
    detect: {
      darwin: { paths: ['/Applications/Zed.app'], type: 'appBundle' },
      linux: { binary: 'zed', type: 'commandV' },
    },
    displayName: 'Zed',
    launch: {
      darwin: { appName: 'Zed', type: 'macOpenA' },
      linux: { binary: 'zed', type: 'exec' },
    },
  },
  webstorm: {
    detect: {
      darwin: { paths: ['/Applications/WebStorm.app'], type: 'appBundle' },
      linux: { binary: 'webstorm', type: 'commandV' },
      win32: { exeName: 'webstorm64.exe', type: 'registryAppPaths' },
    },
    displayName: 'WebStorm',
    launch: {
      darwin: { appName: 'WebStorm', type: 'macOpenA' },
      linux: { binary: 'webstorm', type: 'exec' },
      win32: { binary: 'webstorm', type: 'exec' },
    },
  },
  xcode: {
    detect: { darwin: { paths: ['/Applications/Xcode.app'], type: 'appBundle' } },
    displayName: 'Xcode',
    launch: { darwin: { appName: 'Xcode', type: 'macOpenA' } },
  },
  finder: {
    detect: {
      darwin: { paths: ['/System/Library/CoreServices/Finder.app'], type: 'appBundle' },
    },
    displayName: 'Finder',
    launch: { darwin: { type: 'macOpen' } },
  },
  explorer: {
    detect: { win32: { exeName: 'explorer.exe', type: 'registryAppPaths' } },
    displayName: 'Explorer',
    launch: { win32: { type: 'shellOpenPath' } },
  },
  files: {
    detect: { linux: { binary: 'xdg-open', type: 'commandV' } },
    displayName: 'Files',
    launch: { linux: { type: 'shellOpenPath' } },
  },
  terminal: {
    detect: {
      darwin: {
        paths: [
          '/System/Applications/Utilities/Terminal.app',
          '/Applications/Utilities/Terminal.app',
        ],
        type: 'appBundle',
      },
    },
    displayName: 'Terminal',
    launch: { darwin: { appName: 'Terminal', type: 'macOpenA' } },
  },
  iterm2: {
    detect: { darwin: { paths: ['/Applications/iTerm.app'], type: 'appBundle' } },
    displayName: 'iTerm2',
    launch: { darwin: { appName: 'iTerm', type: 'macOpenA' } },
  },
  ghostty: {
    detect: {
      darwin: { paths: ['/Applications/Ghostty.app'], type: 'appBundle' },
      linux: { binary: 'ghostty', type: 'commandV' },
    },
    displayName: 'Ghostty',
    launch: {
      darwin: { appName: 'Ghostty', type: 'macOpenA' },
      linux: { binary: 'ghostty', type: 'exec' },
    },
  },
};

/** AppIds that are always considered "installed" — file managers, which we treat as platform-provided. */
export const ALWAYS_INSTALLED: Partial<Record<NodeJS.Platform, OpenInAppId>> = {
  darwin: 'finder',
  linux: 'files',
  win32: 'explorer',
};
