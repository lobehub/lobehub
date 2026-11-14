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

export type GuidedPermission = 'accessibility' | 'fullDisk' | 'inputMonitoring' | 'screen';
export type PermissionGuideStatus = 'active' | 'dismissed' | 'granted';

/** Settings → About → Remote debugging. */
export interface RemoteDebuggingSettings {
  /** CDP is open in this launch; differs from `enabled` until the app restarts. */
  active: boolean;
  /** Persisted toggle, read at the next launch. */
  enabled: boolean;
  /** A launch option (`--remote-debugging-port`) opened CDP, so the switch is shown on and locked. */
  openedByLaunchOption: boolean;
  /** Local port CDP listens on while the toggle is on. */
  port: number;
}

/**
 * How long Settings → About → Debug logs stays on: `'24h'` turns itself off a day
 * later, `'always'` stays on until the user turns it off.
 */
export type DebugLoggingDuration = '24h' | 'always';

/** Settings → About → Debug logs. */
export interface DebugLoggingSettings {
  /** Dev builds record `debug` regardless of `enabled`, so the control is shown on and locked. */
  alwaysOn: boolean;
  /** Whether packaged builds also write `debug` records to `<userData>/logs/*.jsonl`. */
  enabled: boolean;
  /**
   * Epoch milliseconds at which debug logging turns itself off. Absent while it is
   * off or set to stay on (`'always'`, also every setting saved before durations existed).
   */
  expiresAt?: number;
}

/** A diagnostics zip written by Settings → About → Diagnostics or the feedback dialog. */
export interface DiagnosticsBundleResult {
  fileName: string;
  /** Absolute path; the file is already selected in Finder / Explorer. */
  filePath: string;
  /** Zip size in bytes. */
  size: number;
}
