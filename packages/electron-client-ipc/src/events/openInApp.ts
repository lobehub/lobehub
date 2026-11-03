export type OpenInAppId =
  | 'vscode'
  | 'cursor'
  | 'zed'
  | 'webstorm'
  | 'xcode'
  | 'finder'
  | 'explorer'
  | 'files'
  | 'terminal'
  | 'iterm2'
  | 'ghostty';

export interface DetectedApp {
  displayName: string;
  /**
   * Base64-encoded PNG data URL (e.g. "data:image/png;base64,..."). Only set
   * when the platform could extract a real icon from the installed app.
   * Renderer falls back to a hard-coded lucide-react icon when absent.
   */
  icon?: string;
  id: OpenInAppId;
  installed: boolean;
}

export interface DetectAppsResult {
  apps: DetectedApp[];
}

export interface OpenInAppParams {
  appId: OpenInAppId;
  path: string;
}

export interface OpenInAppResult {
  error?: string;
  success: boolean;
}
