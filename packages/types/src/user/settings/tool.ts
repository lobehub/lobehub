import type { UserInterventionConfig } from '../../tool';

export interface UserToolConfig {
  humanIntervention?: UserInterventionConfig;
  /**
   * List of builtin tool identifiers that have been uninstalled by the user.
   * By default, all builtin tools are enabled. Users can explicitly
   * uninstall tools they don't want to use.
   */
  uninstalledBuiltinTools?: string[];
}
