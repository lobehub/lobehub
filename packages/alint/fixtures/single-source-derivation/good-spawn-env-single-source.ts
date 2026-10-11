// Fixture: every use of the child's env reads the value the child is spawned with
// (desktop HeterogeneousAgentImpl, `spawnEnv`).
import { spawn } from 'node:child_process';

import { readClaudeCodeSessionCost } from './claudeCodeSessionCost';
import { recordInflightRun } from './inflightRuns';

interface AgentSession {
  agentSessionId?: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  hostedProfileDir?: string;
  sessionId: string;
}

const buildSessionSpawnEnv = (session: AgentSession): NodeJS.ProcessEnv => ({
  ...process.env,
  ...session.env,
});

export const startClaudeCodeSession = async (session: AgentSession, command: string) => {
  const spawnEnv = buildSessionSpawnEnv(session);

  const initialSessionCostUsd = session.agentSessionId
    ? await readClaudeCodeSessionCost({
        configDir: spawnEnv.CLAUDE_CONFIG_DIR,
        cwd: session.cwd,
        home: spawnEnv.HOME,
        sessionId: session.agentSessionId,
      })
    : undefined;

  const proc = spawn(command, ['--output-format', 'stream-json'], {
    cwd: session.cwd,
    env: spawnEnv,
  });

  recordInflightRun({
    configDir: spawnEnv.CLAUDE_CONFIG_DIR ?? session.hostedProfileDir,
    pid: proc.pid,
    sessionId: session.sessionId,
  });

  return { initialSessionCostUsd, proc };
};
