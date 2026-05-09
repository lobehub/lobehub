import debug from 'debug';

import { appEnv } from '@/envs/app';
import type { MarketService } from '@/server/services/market';

const log = debug('lobe-server:hetero-sandbox-runner');

export interface SandboxRunParams {
  agentType: 'claude-code' | 'codex';
  cwd?: string;
  /** GitHub OAuth token for cloning private repos. */
  githubToken?: string;
  /** Operation-scoped JWT injected as LOBEHUB_JWT env in the sandbox. */
  jwt: string;
  marketService: MarketService;
  operationId: string;
  prompt: string;
  /** GitHub repos to clone before running the agent (e.g. ['owner/repo', ...]). */
  repos?: string[];
  resumeSessionId?: string;
  /**
   * Optional context injected as a text block BEFORE the user's prompt.
   * Useful for priming CC with workspace state (cloned repos, env info, etc.).
   * Passed via --input-json as a JSON content-block array — lh already supports this.
   */
  systemContext?: string;
  topicId: string;
  userId: string;
}

/**
 * Derive the local directory name from a repo identifier.
 * Accepts "owner/repo", "https://github.com/owner/repo", or "https://github.com/owner/repo.git".
 * Only allows safe characters to prevent shell injection.
 */
function repoToLocalDir(repo: string): string {
  const raw = (repo.split('/').findLast(Boolean) ?? repo).replace(/\.git$/, '');
  return raw.replaceAll(/[^\w.-]/g, '');
}

/**
 * Build an idempotent setup script that clones each repo if not already present.
 * Uses `[ -d <dir> ] || git clone ...` so re-runs on the same sandbox are no-ops.
 * Returns null when repos is empty.
 */
function buildRepoSetupScript(repos: string[], githubToken?: string): string | null {
  if (!repos || repos.length === 0) return null;

  const lines = repos.map((repo) => {
    const dir = repoToLocalDir(repo);
    // Normalise to "owner/repo" for the clone URL
    const repoPath = repo.startsWith('http') ? (repo.split('github.com/')[1] ?? repo) : repo;
    // Use git's insteadOf rewrite (passed via -c, not stored in .git/config) so the token
    // never ends up in the cloned repo's remote URL.
    const cloneCmd = githubToken
      ? `git -c "url.https://oauth2:${githubToken}@github.com/.insteadOf=https://github.com/" clone -q https://github.com/${repoPath} '${dir}'`
      : `git clone -q 'https://github.com/${repoPath}' '${dir}'`;

    // `|| true` makes clone failures non-fatal — CC still runs even if a repo can't be cloned.
    return `{ [ -d '${dir}' ] || ${cloneCmd}; } || true`;
  });

  return lines.join(' && \\\n');
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
    githubToken,
    jwt,
    marketService,
    operationId,
    prompt,
    repos,
    resumeSessionId,
    topicId,
    userId,
  } = params;

  // cwd is only set when explicitly passed (e.g. desktop local path).
  // For cloud sandbox, CC always runs in the sandbox root (/workspace); repos are cloned
  // as subdirectories there and CC navigates into them via its own tools.
  const { cwd } = params;

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
  // When systemContext is provided, send a content-block array so CC sees the
  // context block first, then the user's actual message. lh already handles
  // JSON arrays via coerceJsonPrompt — no lh changes required.
  const { systemContext } = params;
  const stdinPayload = systemContext
    ? JSON.stringify([
        { text: systemContext, type: 'text' },
        { text: prompt, type: 'text' },
      ])
    : JSON.stringify(prompt);
  const base64Payload = Buffer.from(stdinPayload).toString('base64');

  // LOBEHUB_HETERO_SERVER_URL overrides the server URL for local dev/testing
  // (e.g. a cloudflare tunnel). APP_URL is NOT used here because it's tied to
  // auth callbacks and must stay as localhost in dev.
  const serverUrl = process.env.LOBEHUB_HETERO_SERVER_URL ?? appEnv.APP_URL;
  const envVars = [
    `LOBEHUB_JWT=${JSON.stringify(jwt)}`,
    `LOBEHUB_SERVER=${JSON.stringify(serverUrl)}`,
    // Inject GitHub token so CC can authenticate git operations and GitHub API
    // calls inside the sandbox (e.g. gh CLI, git push, API requests).
    ...(githubToken ? [`GITHUB_TOKEN=${JSON.stringify(githubToken)}`] : []),
  ].join(' ');
  const mainCommand = `echo ${base64Payload} | base64 -d | ${envVars} ${args.join(' ')}`;
  const setupScript = buildRepoSetupScript(repos ?? [], githubToken);
  const shellCommand = setupScript ? `${setupScript} && \\\n${mainCommand}` : mainCommand;

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
