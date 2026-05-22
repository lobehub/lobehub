import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TaskEntry {
  agentId?: string;
  agentType: 'hermes' | 'openclaw';
  operationId: string;
  pid: number;
  startedAt: string;
  taskId: string;
  topicId: string;
}

function getRegistryPath(): string {
  return path.join(os.homedir(), '.lobehub', 'task-registry.json');
}

function readRegistry(): Record<string, TaskEntry> {
  try {
    return JSON.parse(fs.readFileSync(getRegistryPath(), 'utf8')) as Record<string, TaskEntry>;
  } catch {
    return {};
  }
}

function writeRegistry(entries: Record<string, TaskEntry>): void {
  const dir = path.dirname(getRegistryPath());
  fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  fs.writeFileSync(getRegistryPath(), JSON.stringify(entries, null, 2), { mode: 0o600 });
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
