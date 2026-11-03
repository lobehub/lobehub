export interface ShortcutConfig {
  /**
   * Shortcut accelerator (e.g. CommandOrControl+E)
   */
  accelerator: string;
  /**
   * Shortcut ID
   */
  id: string;
}
export type ShortcutActionType = Record<string, any>;

export interface ShortcutUpdateResult {
  errorType?:
    | 'INVALID_ID'
    | 'INVALID_FORMAT'
    | 'NO_MODIFIER'
    | 'CONFLICT'
    | 'SYSTEM_OCCUPIED'
    | 'UNKNOWN';
  success: boolean;
}
