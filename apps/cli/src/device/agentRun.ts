import { spawn } from 'node:child_process';

export interface SpawnHeteroAgentRunParams {
  agentType: string;
  cwd?: string;
  jwt: string;
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
  serverUrl: string;
  systemContext?: string;
  topicId: string;
}

interface SpawnHeteroAgentRunLogger {
  error?: (msg: string) => void;
  info?: (msg: string) => void;
}

/**
 * Spawn `lh hetero exec` for a gateway-dispatched agent run. Mirrors the
 * desktop app's `spawnLhHeteroExec`: the spawned CLI owns the full pipeline
 * (spawn -> adapt -> BatchIngester -> server ingest), so the connect daemon
 * needs no local stream handling — it only kicks off the process.
 *
 * Re-invokes the current CLI entry (`process.execPath` + `process.argv[1]`)
 * instead of relying on `lh` being on `PATH`, so it also works inside the
 * detached `lh connect --daemon` child where `PATH` may be minimal.
 */
export function spawnHeteroAgentRun(
  params: SpawnHeteroAgentRunParams,
  logger?: SpawnHeteroAgentRunLogger,
): void {
  const {
    agentType,
    cwd,
    jwt,
    operationId,
    prompt,
    resumeSessionId,
    serverUrl,
    systemContext,
    topicId,
  } = params;
  const workDir = cwd ?? process.cwd();

  // Server-ingest mode (--topic + --operation-id): events are batch-POSTed to
  // the server, not rendered. `--input-json -` reads the prompt from stdin.
  const cliArgs = [
    process.argv[1],
    'hetero',
    'exec',
    '--type',
    agentType,
    '--operation-id',
    operationId,
    '--topic',
    topicId,
    '--render',
    'none',
    '--input-json',
    '-',
    '--cwd',
    workDir,
    ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  ];

  const child = spawn(process.execPath, [...process.execArgv, ...cliArgs], {
    cwd: workDir,
    env: {
      ...process.env,
      LOBEHUB_JWT: jwt,
      LOBEHUB_SERVER: serverUrl,
    },
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  // With systemContext, send a content-block array so the agent sees the
  // context block first, then the user's actual prompt — mirrors the desktop
  // path. `lh hetero exec` coerces both shapes via coerceJsonPrompt.
  const stdinPayload = systemContext
    ? JSON.stringify([
        { text: systemContext, type: 'text' },
        { text: prompt, type: 'text' },
      ])
    : JSON.stringify(prompt);
  child.stdin?.write(stdinPayload);
  child.stdin?.end();

  child.on('error', (err) => {
    logger?.error?.(`hetero exec spawn failed (op=${operationId}): ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    logger?.info?.(`hetero exec exited (op=${operationId}) code=${code} signal=${signal}`);
  });
}
