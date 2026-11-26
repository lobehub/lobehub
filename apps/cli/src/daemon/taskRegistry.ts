import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CLI_CONFIG_DIR_NAME } from '../constants/identity';
import { log } from '../utils/logger';

export interface TaskEntry {
  agentId?: string;
  /**
   * Heterogeneous agent type. Covers remote platform agents (`hermes`,
   * `openclaw`) and local CLI agents (`devin`, `claude-code`, `codex`, …)
   * dispatched through `lh connect` device gateway.
   */
  agentType: string;
  operationId: string;
  parentOperationId?: string;
  pid: number;
  startedAt: string;
  taskId: string;
  topicId: string;
  /**
   * Workspace that owns the dispatched topic. Persisted so the cancel-time
   * notify still scopes to the right workspace after the daemon restarts.
   */
  workspaceId?: string;
}

function getRegistryPath(): string {
  return path.join(os.homedir(), CLI_CONFIG_DIR_NAME, 'task-registry.json');
}

/**
 * Registry state this process could not persist. While set it is the source of
 * truth for this process, so spawn, exit and cancel handlers still agree on who
 * owns a run; the next successful write clears it.
 */
let unsavedRegistry: Record<string, TaskEntry> | undefined;

function readRegistry(): Record<string, TaskEntry> {
  if (unsavedRegistry) return { ...unsavedRegistry };
  try {
    return JSON.parse(fs.readFileSync(getRegistryPath(), 'utf8')) as Record<string, TaskEntry>;
  } catch {
    return {};
  }
}

/**
 * Persists the registry without ever throwing.
 *
 * Callers run inside child-process `spawn` / `exit` handlers of the connect
 * daemon, where an uncaught error (for example ENOSPC on a full disk) kills
 * the daemon and every run it supervises. A failed write keeps the state in
 * memory instead; only a daemon restart loses it, and cancellation then falls
 * back to the process table.
 */
function writeRegistry(entries: Record<string, TaskEntry>): void {
  try {
    const dir = path.dirname(getRegistryPath());
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    fs.writeFileSync(getRegistryPath(), JSON.stringify(entries, null, 2), { mode: 0o600 });
    unsavedRegistry = undefined;
  } catch (error) {
    unsavedRegistry = entries;
    log.warn(
      `Failed to write task registry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function saveTask(entry: TaskEntry): void {
  const registry = readRegistry();
  registry[entry.taskId] = entry;
  writeRegistry(registry);
}

export function getTask(taskId: string): TaskEntry | undefined {
  return readRegistry()[taskId];
}

export function removeTask(taskId: string): void {
  const registry = readRegistry();
  delete registry[taskId];
  writeRegistry(registry);
}

export function listTasks(): TaskEntry[] {
  return Object.values(readRegistry());
}
