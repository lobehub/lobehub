import type { UserInterventionConfig } from '../../tool';

export interface UserToolConfig {
  humanIntervention?: UserInterventionConfig;
  /**
   * List of builtin tool identifiers that have been uninstalled by the user.
   * By default, all builtin tools are enabled. Users can explicitly
   * uninstall tools they don't want to use.
   *
   * This is the personal-context list (no active workspace). Workspace-scoped
   * lists are kept separately in `uninstalledBuiltinToolsByWorkspace` so a
   * workspace never inherits the user's personal customization.
   */
  uninstalledBuiltinTools?: string[];
  /**
   * Per-workspace uninstalled builtin tool lists, keyed by workspace id.
   * A workspace with no entry falls back to the default seed (i.e. a clean
   * default state), not the user's personal `uninstalledBuiltinTools`.
   */
  uninstalledBuiltinToolsByWorkspace?: Record<string, string[]>;
}
