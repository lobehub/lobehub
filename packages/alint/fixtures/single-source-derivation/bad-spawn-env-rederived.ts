// Fixture: the child's env is built once and spawned with, then one of its keys is
// re-derived from the inputs for the transcript lookup (PR #20439, spawnAgent.ts).
import { spawn } from 'node:child_process';

import { readClaudeCodeSessionCost } from './claudeCodeSessionCost';

export interface SpawnAgentOptions {
  agentType: 'claude-code' | 'codex';
  cwd: string;
  env?: Record<string, string | undefined>;
  resumeSessionId?: string;
}

export const spawnAgent = async (options: SpawnAgentOptions, command: string, args: string[]) => {
  const childEnv = {
    ...process.env,
    ...(options.agentType === 'codex' ? { CODEX_DISABLE_UPDATE_CHECK: '1' } : {}),
    ...options.env,
  };

  const initialSessionCostUsd =
    options.agentType === 'claude-code' && options.resumeSessionId
      ? await readClaudeCodeSessionCost({
          // alint-expect
          configDir: options.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR,
          cwd: options.cwd,
          // Resolve from the child's environment: an overridden HOME moves the
          // transcript the CLI resumes from.
          home: options.env?.HOME,
          sessionId: options.resumeSessionId,
        })
      : undefined;

  const proc = spawn(command, args, {
    cwd: options.cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return { initialSessionCostUsd, proc };
};
