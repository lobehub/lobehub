const MAIN_AGENT_STORAGE_KEY = 'lobechat-project-main-agent';

/**
 * Remembered in place of an agent id when the last project got an agent of its
 * own. Agent ids carry a prefix, so this never collides with one.
 */
export const DEDICATED_MAIN_AGENT = 'dedicated';

/** Lead a new project with an agent created for it, or with an existing one. */
export type MainAgentMode = 'dedicated' | 'existing';

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

export const resolveDefaultMainAgentMode = (remembered?: string): MainAgentMode =>
  remembered === DEDICATED_MAIN_AGENT ? 'dedicated' : 'existing';

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
  if (remembered === DEDICATED_MAIN_AGENT) return inboxAgentId;
  if (remembered && (!listLoaded || remembered === inboxAgentId || agentExists(remembered))) {
    return remembered;
  }
  return inboxAgentId;
};
