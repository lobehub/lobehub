/** An optional settings tab supplied by a business build. */
export interface BusinessSettingsTab {
  /** The sidebar label and page title. */
  label: string;
}

/**
 * The optional `coding-plans` settings tab in the current settings context
 * (personal or the active workspace), or `null` to leave it out. Off by
 * default.
 */
export const useCodingPlansTab = (): BusinessSettingsTab | null => null;
