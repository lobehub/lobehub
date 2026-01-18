/**
 * Shortcut action type enum
 */
export const ShortcutActionEnum = {
  openSettings: 'openSettings',
  /**
   * Show/hide main window
   */
  showApp: 'showApp',
} as const;

export type ShortcutActionType = (typeof ShortcutActionEnum)[keyof typeof ShortcutActionEnum];

/**
 * Default shortcut configuration
 */
export const DEFAULT_SHORTCUTS_CONFIG: Record<ShortcutActionType, string> = {
  [ShortcutActionEnum.showApp]: 'Control+E',
  [ShortcutActionEnum.openSettings]: 'CommandOrControl+,',
};
