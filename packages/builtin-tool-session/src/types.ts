export const SessionApiName = {
  archiveSession: 'archiveSession',
  getSession: 'getSession',
  listSessions: 'listSessions',
  readSession: 'readSession',
  sendToSession: 'sendToSession',
  startSession: 'startSession',
  stopSession: 'stopSession',
} as const;

export type SessionApiNameType = (typeof SessionApiName)[keyof typeof SessionApiName];

/** Where a sub-session works. */
export type SessionWorkspace = 'inherit' | 'new-worktree' | 'none';

export type SessionState = 'archived' | 'failed' | 'idle' | 'running' | 'waiting_for_user';

export interface StartSessionParams {
  /** Agent to run the sub-session; defaults to the current agent. */
  agentId?: string;
  /** Branch a new worktree forks from (`workspace: 'new-worktree'`). */
  baseBranch?: string;
  /** Device to run on; defaults to this conversation's device. */
  deviceId?: string;
  prompt: string;
  title?: string;
  workspace?: SessionWorkspace;
}

export interface StartSessionState {
  agentId?: string;
  branch?: string;
  topicId: string;
  workingDirectory?: string;
}

export interface TopicIdParams {
  topicId: string;
}

export interface ReadSessionParams extends TopicIdParams {
  /** How many of the latest messages to read (default 30). */
  limit?: number;
}

export interface SendToSessionParams extends TopicIdParams {
  message: string;
}

export interface SessionSummary {
  agentId?: null | string;
  state: SessionState;
  title?: null | string;
  topicId: string;
}

export interface ListSessionsState {
  sessions: SessionSummary[];
}

export interface GetSessionState extends SessionSummary {
  lastReply?: string;
}
