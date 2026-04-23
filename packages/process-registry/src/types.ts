export interface ProcessTags {
  [k: string]: string | undefined;
  messageId?: string;
  /** Required. Short identifier of the subsystem that spawned the process (e.g. 'shell', 'acp', 'heteroAgent', 'cli', 'git', 'toolDetector'). */
  ownerModule: string;
  sessionId?: string;
  toolCallId?: string;
  topicId?: string;
}

export type ProcessStatus = 'running' | 'exited' | 'killed';

export interface RegisteredProcess {
  args: string[];
  command: string;
  exitCode: number | null;
  exitedAt?: number;
  pgid?: number;
  pid: number;
  shellId: string;
  startedAt: number;
  status: ProcessStatus;
  tags: ProcessTags;
}

export interface ProcessListFilter {
  ownerModule?: string;
  sessionId?: string;
  status?: ProcessStatus;
  toolCallId?: string;
  topicId?: string;
}

export interface ProcessKillFilter {
  ownerModule?: string;
  sessionId?: string;
  shellId?: string;
  toolCallId?: string;
  topicId?: string;
}

export type ProcessRegistryEvent =
  | { process: RegisteredProcess; type: 'registered' }
  | { process: RegisteredProcess; type: 'exited' }
  | { process: RegisteredProcess; type: 'killed' };

export type ProcessRegistryListener = (event: ProcessRegistryEvent) => void;
