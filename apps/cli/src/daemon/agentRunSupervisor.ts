import type { ChildProcess } from 'node:child_process';

export type AgentRunCancelSignal = 'SIGINT' | 'SIGKILL' | 'SIGTERM';

export interface AgentRunEntry {
  agentType: string;
  child: ChildProcess;
  operationId: string;
  pid?: number;
  startedAt: string;
  topicId: string;
}

export interface RegisterAgentRunParams {
  agentType: string;
  child: ChildProcess;
  operationId: string;
  topicId: string;
}

export interface CancelAgentRunParams {
  operationId: string;
  signal?: AgentRunCancelSignal;
}

export interface CancelAgentRunResult {
  message?: string;
  operationId: string;
  pid?: number;
  signal?: AgentRunCancelSignal;
  success: boolean;
}

const runs = new Map<string, AgentRunEntry>();

export function registerAgentRun({
  agentType,
  child,
  operationId,
  topicId,
}: RegisterAgentRunParams): AgentRunEntry {
  const entry: AgentRunEntry = {
    agentType,
    child,
    operationId,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    topicId,
  };

  runs.set(operationId, entry);

  const cleanup = () => {
    const current = runs.get(operationId);
    if (current?.child === child) runs.delete(operationId);
  };

  child.once('exit', cleanup);
  child.once('close', cleanup);

  return entry;
}

export function getAgentRun(operationId: string): AgentRunEntry | undefined {
  return runs.get(operationId);
}

export function listAgentRuns(): AgentRunEntry[] {
  return [...runs.values()];
}

export async function cancelAgentRun({
  operationId,
  signal = 'SIGINT',
}: CancelAgentRunParams): Promise<CancelAgentRunResult> {
  const entry = runs.get(operationId);

  if (!entry) {
    return {
      message: `No agent run found with operationId: ${operationId}`,
      operationId,
      success: false,
    };
  }

  const killed = entry.child.kill(signal);

  return {
    message: killed ? undefined : `Failed to send ${signal} to operationId: ${operationId}`,
    operationId,
    pid: entry.pid,
    signal,
    success: killed,
  };
}

export function clearAgentRunsForTest(): void {
  runs.clear();
}
