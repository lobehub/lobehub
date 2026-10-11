// Fixture: the file owns the resolver for the child's env, yet the transcript replay
// re-derives the config dir the CLI wrote to from session fields and skips the
// inherited CLAUDE_CONFIG_DIR that the spawn env merges in
// (desktop HeterogeneousAgentImpl, replayTranscript).
import { spawn } from 'node:child_process';

import { readClaudeCodeReplayTurn } from './claudeCodeTranscript';

interface AgentSession {
  agentSessionId: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  hostedProfileDir?: string;
}

export class HeterogeneousAgentRunner {
  private buildSessionSpawnEnv(session: AgentSession): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...(session.hostedProfileDir ? { CLAUDE_CONFIG_DIR: session.hostedProfileDir } : {}),
      ...session.env,
    };
  }

  start(session: AgentSession, command: string) {
    return spawn(command, ['--resume', session.agentSessionId], {
      cwd: session.cwd,
      env: this.buildSessionSpawnEnv(session),
    });
  }

  async replayTranscript(session: AgentSession, prompt: string) {
    return readClaudeCodeReplayTurn({
      // alint-expect
      configDir: session.env?.CLAUDE_CONFIG_DIR ?? session.hostedProfileDir,
      cwd: session.cwd,
      expectedPrompt: prompt,
      sessionId: session.agentSessionId,
    });
  }
}
