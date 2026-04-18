export interface ElectronAppState {
  arch?: string; // e.g., 'x64', 'arm64'
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

export interface GitBranchInfo {
  /** Branch short name, or short SHA when in detached HEAD state */
  branch?: string;
  /** True when HEAD is detached (no branch ref) */
  detached?: boolean;
}

export interface GitLinkedPullRequest {
  number: number;
  state: string;
  title: string;
  url: string;
}

export interface GitLinkedPullRequestResult {
  /** Additional open PRs targeting the same head branch, beyond the primary one */
  extraCount?: number;
  /** Null when no open PR is linked to the branch */
  pullRequest: GitLinkedPullRequest | null;
  /** 'ok' — lookup succeeded; 'gh-missing' — gh CLI unavailable / not authed; 'error' — other failure */
  status: 'ok' | 'gh-missing' | 'error';
}

export interface GitBranchListItem {
  current: boolean;
  name: string;
  upstream?: string;
}

export interface GitWorkingTreeStatus {
  clean: boolean;
  /** Count of modified / staged / untracked files (each file counted once) */
  modified: number;
}

export interface GitCheckoutResult {
  error?: string;
  success: boolean;
}
