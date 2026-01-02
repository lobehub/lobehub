export interface OpenSettingsWindowOptions {
  /**
   * Direct path to navigate to (e.g., '/settings/provider/openai').
   * Takes precedence over tab and searchParams if provided.
   */
  path?: string;
  /**
   * @deprecated Use `path` instead. Query parameters that should be appended to the settings URL.
   */
  searchParams?: Record<string, string | undefined>;
  /**
   * @deprecated Use `path` instead. Settings page tab path or identifier.
   */
  tab?: string;
}
