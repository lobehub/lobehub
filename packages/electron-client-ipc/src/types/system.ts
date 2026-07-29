export interface ElectronAppState {
  arch?: string; // e.g., 'x64', 'arm64'
  /** Human-readable name of the shell that `runCommand` uses (e.g. "PowerShell 7+ (pwsh)"). */
  defaultShell?: string;
  isLinux?: boolean;
  isMac?: boolean;
  isWindows?: boolean;
  locale?: string;
  platform?: 'darwin' | 'win32' | 'linux';
  systemAppearance?: string;
  userPath?: UserPathData;
}

/**
 * Defines the structure for user-specific paths obtained from Electron.
 */
export interface UserPathData {
  desktop: string;
  documents: string;
  downloads?: string;
  // App data directory
  home: string;
  // Optional as not all OS might have it easily accessible or standard
  music?: string;
  pictures?: string;
  userData: string;
  videos?: string; // User's home directory
}

export type ThemeMode = 'system' | 'dark' | 'light';
export type ThemeAppearance = 'dark' | 'light' | string;
