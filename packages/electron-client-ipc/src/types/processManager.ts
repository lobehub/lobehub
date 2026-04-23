// ─── Process Manager (spawned child process tracking) ─────────────────────

export type ProcessStatus = 'running' | 'exited' | 'killed';

export interface ProcessInfo {
  args: string[];
  command: string;
  exitCode: number | null;
  exitedAt?: number;
  ownerModule: string;
  pgid?: number;
  pid: number;
  sessionId?: string;
  shellId: string;
  startedAt: number;
  status: ProcessStatus;
  tags: Record<string, string | undefined>;
  toolCallId?: string;
  topicId?: string;
}

export interface ListProcessesParams {
  ownerModule?: string;
  sessionId?: string;
  status?: ProcessStatus;
  toolCallId?: string;
  topicId?: string;
}

export interface ListProcessesResult {
  processes: ProcessInfo[];
}

export interface KillProcessParams {
  /** One of these must be provided. `ownerModule` alone is rejected. */
  ownerModule?: string;
  sessionId?: string;
  shellId?: string;
  toolCallId?: string;
  topicId?: string;
}

export interface KillProcessResult {
  error?: string;
  killedShellIds: string[];
  success: boolean;
}
