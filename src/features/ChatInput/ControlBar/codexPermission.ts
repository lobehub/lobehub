interface CodexPermissionConfigurableOptions {
  agentId: string;
  canConfigure: boolean;
  isLocalExecution: boolean;
  saving: boolean;
}

/**
 * Checks whether the current surface can persist a native permission selection.
 *
 * Use when:
 * - Rendering a Codex permission control.
 *
 * Expects:
 * - Resource access, local execution, and active-save state from the host.
 *
 * Returns:
 * - Whether this agent can accept a permission change now.
 */
export const isCodexPermissionConfigurable = ({
  agentId,
  canConfigure,
  isLocalExecution,
  saving,
}: CodexPermissionConfigurableOptions): boolean =>
  Boolean(agentId) && canConfigure && isLocalExecution && !saving;
