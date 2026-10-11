// Fixture: each branch spawns a different child and builds that child's env once;
// two merges of the same shape for two processes are two entities (spawnAgent.ts).
import { GrokAcpSession } from './grokAcpSession';
import { KimiAcpSession } from './kimiAcpSession';

export interface SpawnAcpOptions {
  agentType: 'grok' | 'kimi';
  command: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}

const spawnGrokAcpAgent = (options: SpawnAcpOptions) =>
  new GrokAcpSession({
    commandPath: options.command,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });

const spawnKimiAcpAgent = (options: SpawnAcpOptions) =>
  new KimiAcpSession({
    commandPath: options.command,
    cwd: options.cwd,
    env: { ...process.env, KIMI_DISABLE_TELEMETRY: '1', ...options.env },
  });

export const spawnAcpAgent = (options: SpawnAcpOptions) =>
  options.agentType === 'grok' ? spawnGrokAcpAgent(options) : spawnKimiAcpAgent(options);
