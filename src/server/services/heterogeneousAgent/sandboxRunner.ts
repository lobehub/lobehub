import debug from 'debug';

import { appEnv } from '@/envs/app';
import type { MarketService } from '@/server/services/market';

const log = debug('lobe-server:hetero-sandbox-runner');

export interface SandboxRunParams {
  agentType: 'claude-code' | 'codex';
  cwd?: string;
  /** Operation-scoped JWT injected as LOBEHUB_JWT env in the sandbox. */
  jwt: string;
  marketService: MarketService;
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
  topicId: string;
  userId: string;
}

/**
 * Launches `lh hetero exec` inside the cloud sandbox via `runCommand`.
 *
 * Uses the same MarketService path as ServerSandboxService.callTool —
 * `marketService.getSDK().plugins.runBuildInTool('runCommand', params, ctx)`.
 *
 * The sandbox container already has `lh` (the LobeHub CLI) installed.
 * The operation-scoped JWT is injected as `LOBEHUB_JWT` so the CLI can
 * authenticate against `heteroIngest` / `heteroFinish` without user creds.
 *
 * Fire-and-forget: the caller does NOT await this — the sandbox pushes events
 * back to the server via `heteroIngest` tRPC batches independently.
 */
export async function spawnHeteroSandbox(params: SandboxRunParams): Promise<void> {
  const {
    agentType,
    cwd,
    jwt,
    marketService,
    operationId,
    prompt,
    resumeSessionId,
    topicId,
    userId,
  } = params;

  // Build the `lh hetero exec` command string.
  // Prompt is passed via --input-json stdin ('-') to avoid shell quoting issues
  // with arbitrary user text in --prompt.
  const args = [
    'lh',
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
  ];
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }
  if (cwd) {
    args.push('--cwd', cwd);
  }

  // Encode the prompt as base64 to avoid all shell quoting issues.
  // echo + shell quoting mangled inner JSON quotes; base64 is quote-safe.
  const stdinPayload = JSON.stringify(prompt);
  const base64Payload = Buffer.from(stdinPayload).toString('base64');

  // LOBEHUB_HETERO_SERVER_URL overrides the server URL for local dev/testing
  // (e.g. a cloudflare tunnel). APP_URL is NOT used here because it's tied to
  // auth callbacks and must stay as localhost in dev.
  const serverUrl = process.env.LOBEHUB_HETERO_SERVER_URL ?? appEnv.APP_URL;
  const shellCommand = `echo ${base64Payload} | base64 -d | LOBEHUB_JWT=${JSON.stringify(jwt)} LOBEHUB_SERVER=${JSON.stringify(serverUrl)} ${args.join(' ')}`;

  log(
    'spawnHeteroSandbox: userId=%s op=%s type=%s topic=%s',
    userId,
    operationId,
    agentType,
    topicId,
  );

  await marketService
    .getSDK()
    .plugins.runBuildInTool('runCommand', { command: shellCommand } as any, { topicId, userId });
}
