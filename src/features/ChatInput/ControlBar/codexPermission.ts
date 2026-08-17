interface CodexPermissionConfigurableOptions {
  agentId: string;
  canConfigure: boolean;
  isLocalExecution: boolean;
  saving: boolean;
}

export const isCodexPermissionConfigurable = ({
  agentId,
  canConfigure,
  isLocalExecution,
  saving,
}: CodexPermissionConfigurableOptions): boolean =>
  Boolean(agentId) && canConfigure && isLocalExecution && !saving;
