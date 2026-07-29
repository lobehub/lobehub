// IMPORTANT: import from `/protocol`, NOT `/spawn` — the spawn barrel drags
// fs-heavy machinery into the Next.js server bundle, and its dynamic
// `process.cwd()`-rooted fs calls make Vercel's file tracing pull the whole
// repo source tree into every serverless function (250 MB limit blowout).
import {
  buildHeteroExecStdinPayload,
  type HeteroExecImageRef,
} from '@lobechat/heterogeneous-agents/protocol';
import debug from 'debug';

import { appEnv } from '@/envs/app';
import type { MarketService } from '@/server/services/market';
import { createSandboxService } from '@/server/services/sandbox';

const log = debug('lobe-server:hetero-sandbox-runner');

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export interface SandboxRunParams {
  agentType: 'claude-code' | 'codex';
  /** Resolved `lh hetero exec` wrapper args. */
  args?: string[];
  /** Initial assistant placeholder message id — injected as LOBEHUB_ASSISTANT_MESSAGE_ID so
   * the CLI can pass it through the heteroIngest payload, removing the need for the server
   * to re-read topic.metadata.runningOperation on every cold Lambda start. */
  assistantMessageId: string;
  cwd?: string;
  /** GitHub OAuth token for cloning private repos. */
  githubToken?: string;
  /**
   * Image attachments from the user message, as URLs the sandbox can fetch
   * (signed S3 URLs). Appended as image content blocks after the prompt so
   * the CLI gets vision input.
   */
  imageList?: HeteroExecImageRef[];
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
 * Write GitHub credentials into the sandbox in the same format produced by
 * `injectCredsToSandbox(["github"])` so CC can source them from sub-shells:
 *
 *   source ~/.creds/env          # exports GITHUB_ACCESS_TOKEN
 *   echo $GITHUB_ACCESS_TOKEN | gh auth login --hostname github.com --with-token
 *
 * Also authenticates the `gh` CLI upfront so all `gh` commands work out of
 * the box without CC having to call inject first.
 *
 * Returns null when no token is available.
 */
function buildCredsSetupScript(githubToken?: string): string | null {
  if (!githubToken) return null;
  const tokenArg = shellQuote(githubToken);
  return [
    'mkdir -p ~/.creds',
    // Write GITHUB_ACCESS_TOKEN matching the injectCredsToSandbox oauth naming scheme
    `printf 'GITHUB_ACCESS_TOKEN=%s\\n' ${tokenArg} > ~/.creds/env`,
    // Pre-authenticate gh CLI so CC can use it immediately (gh also picks up
    // GITHUB_TOKEN from env, but explicit login ensures ~/.config/gh/hosts.yml
    // is populated for cases where env is reset in a sub-shell)
    `echo ${tokenArg} | gh auth login --hostname github.com --with-token 2>/dev/null || true`,
  ].join(' && \\\n');
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
    const dirArg = shellQuote(dir);
    const repoUrlArg = shellQuote(`https://github.com/${repoPath}`);
    const cloneCmd = githubToken
      ? `git -c ${shellQuote(
          `url.https://oauth2:${githubToken}@github.com/.insteadOf=https://github.com/`,
        )} clone -q ${repoUrlArg} ${dirArg}`
      : `git clone -q ${repoUrlArg} ${dirArg}`;

    // `|| true` makes clone failures non-fatal — CC still runs even if a repo can't be cloned.
    return `{ [ -d ${dirArg} ] || ${cloneCmd}; } || true`;
  });

  return lines.join(' && \\\n');
}

/**
 * Launches `lh hetero exec` inside the cloud sandbox via `runCommand`.
 *
 * Uses the configured sandbox provider so cloud, third-party, and self-hosted
 * sandboxes share the same launch path.
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
    args: extraArgs,
    assistantMessageId,
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

  // For cloud sandbox, default cwd is /workspace — must be explicit so CC stores and
  // finds session files at the same path on every invocation (session files live under
  // ~/.claude/projects/<encoded-cwd>/). Without a consistent --cwd the session id stored
  // in topic.metadata.heteroSessionId can't be resolved on --resume after a page reload.
  const cwd = params.cwd ?? '/workspace';

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
  args.push('--cwd', cwd);
  args.push(...(extraArgs ?? []));

  // Encode the prompt as base64 to avoid all shell quoting issues.
  // echo + shell quoting mangled inner JSON quotes; base64 is quote-safe.
  // systemContext / image attachments turn the payload into a content-block
  // array. lh already handles both shapes via coerceJsonPrompt — no lh
  // changes required.
  const stdinPayload = buildHeteroExecStdinPayload({
    imageList: params.imageList,
    prompt,
    systemContext: params.systemContext,
  });
  const base64Payload = Buffer.from(stdinPayload).toString('base64');

  // LOBEHUB_HETERO_SERVER_URL overrides the server URL for local dev/testing
  // (e.g. a cloudflare tunnel). APP_URL is NOT used here because it's tied to
  // auth callbacks and must stay as localhost in dev.
  const serverUrl = process.env.LOBEHUB_HETERO_SERVER_URL ?? appEnv.APP_URL;
  const envVars = [
    `LOBEHUB_JWT=${shellQuote(jwt)}`,
    `LOBEHUB_SERVER=${shellQuote(serverUrl)}`,
    `LOBEHUB_ASSISTANT_MESSAGE_ID=${shellQuote(assistantMessageId)}`,
    // Inject GitHub token so CC can authenticate git operations and GitHub API
    // calls inside the sandbox (e.g. gh CLI, git push, API requests).
    ...(githubToken ? [`GITHUB_TOKEN=${shellQuote(githubToken)}`] : []),
  ].join(' ');
  const shellArgs = args.map(shellQuote).join(' ');
  const mainCommand = `echo ${shellQuote(base64Payload)} | base64 -d | ${envVars} ${shellArgs}`;
  // Creds first (writes ~/.creds/env + authenticates gh CLI), then repo clone.
  const credsScript = buildCredsSetupScript(githubToken);
  const repoScript = buildRepoSetupScript(repos ?? [], githubToken);
  const setupParts = [credsScript, repoScript].filter(Boolean);
  const shellCommand =
    setupParts.length > 0 ? `${setupParts.join(' && \\\n')} && \\\n${mainCommand}` : mainCommand;

  log(
    'spawnHeteroSandbox: userId=%s op=%s type=%s topic=%s',
    userId,
    operationId,
    agentType,
    topicId,
  );

  const sandboxService = createSandboxService({ marketService, topicId, userId });
  const result = await sandboxService.callTool('runCommand', {
    background: true,
    command: shellCommand,
    timeout: 600_000,
  });

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to spawn heterogeneous sandbox');
  }
}
