interface CodexPermissionConfigurableOptions {
  agentId: string;
  canConfigure: boolean;
  saving: boolean;
}

/**
 * Checks whether the current surface can persist a native permission selection.
 *
 * Use when:
 * - Rendering a Codex permission control.
 *
 * Expects:
 * - Resource access and active-save state from the host; the selector filters target-specific modes.
 *
 * Returns:
 * - Whether this agent can accept a permission change now.
 */
export const isCodexPermissionConfigurable = ({
  agentId,
  canConfigure,
  saving,
}: CodexPermissionConfigurableOptions): boolean => Boolean(agentId) && canConfigure && !saving;
