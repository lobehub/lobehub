const MAIN_AGENT_STORAGE_KEY = 'lobechat-project-main-agent';

// Agent ids belong to one workspace, so each workspace remembers its own pick.
const storageKey = (workspaceId?: string | null) =>
  `${MAIN_AGENT_STORAGE_KEY}:${workspaceId ?? 'personal'}`;

export const readRememberedMainAgent = (workspaceId?: string | null): string | undefined => {
  try {
    return window.localStorage.getItem(storageKey(workspaceId)) || undefined;
  } catch {
    return undefined;
  }
};

export const writeRememberedMainAgent = (agentId: string, workspaceId?: string | null) => {
  try {
    window.localStorage.setItem(storageKey(workspaceId), agentId);
  } catch {
    return;
  }
};

/**
 * Reuse the remembered main agent while it still exists; otherwise LobeAI.
 * Before the agent list loads the remembered id is trusted as-is.
 */
export const resolveDefaultMainAgent = ({
  agentExists,
  inboxAgentId,
  listLoaded,
  remembered,
}: {
  agentExists: (id: string) => boolean;
  inboxAgentId?: string;
  listLoaded: boolean;
  remembered?: string;
}): string | undefined => {
  if (remembered && (!listLoaded || remembered === inboxAgentId || agentExists(remembered))) {
    return remembered;
  }
  return inboxAgentId;
};
