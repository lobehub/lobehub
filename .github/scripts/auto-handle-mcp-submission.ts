#!/usr/bin/env bun
/**
 * Auto-handle "Add my MCP server to the marketplace" issues.
 *
 * MCP listing requests are now self-service via the @lobehub/market-cli, so we
 * no longer take them through GitHub issues. This script runs when an issue is
 * opened: if it is a *new-server listing request* (and NOT a marketplace bug or
 * CLI feedback), it labels the issue `mcp-submission`, posts the redirect
 * template (pointing at the CLI, with the author's own repo filled in), and
 * closes it as `not_planned`. The comment invites the author to reopen if it
 * was closed by mistake.
 *
 * Anything that is not a confident match is left untouched for normal triage.
 */

import { classify } from './shared/mcp-submission-classifier';

declare global {
  // @ts-ignore
  var process: {
    env: Record<string, string | undefined>;
    exitCode?: number;
  };
}

const MARKER = '<!-- bot:mcp-submission -->';
const LABEL = 'mcp-submission';
const LABEL_REMOTE = 'mcp:remote';
const REPO_PLACEHOLDER = 'https://github.com/<owner>/<repo>';

interface GitHubLabel {
  name: string;
}

interface GitHubIssue {
  body: string | null;
  labels: GitHubLabel[];
  number: number;
  state: string;
  title: string;
  user: { login: string };
}

interface GitHubComment {
  body: string;
}

async function githubRequest<T>(
  endpoint: string,
  token: string,
  method: string = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'auto-handle-mcp-submission-script',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API ${method} ${endpoint} failed: ${response.status} ${response.statusText}`,
    );
  }

  // Some endpoints (e.g. label add) return 200 with a body; others may be empty.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function buildComment(repoUrl: string | null): string {
  const submitUrl = repoUrl ?? REPO_PLACEHOLDER;

  return `${MARKER}
👋 Thanks for this! Heads-up: **we no longer take MCP listing requests via issues** — there's now a self-service flow, so you can list and manage your server yourself without waiting on us.

**Easiest — let your coding agent do it.** Paste this into Claude Code / Cursor / Codex / etc.:

\`\`\`text
Read https://lobehub.com/publish-mcp/skill.md and follow the instructions to publish my MCP server to the LobeHub Marketplace
\`\`\`

It reads our publishing skill and drives the CLI for you (login → verify GitHub ownership → submit your repo).

**Prefer to run it yourself?** Use the official CLI directly (Node.js ≥ 22):

\`\`\`bash
npx -y @lobehub/market-cli login            # browser login
npx -y @lobehub/market-cli github connect    # verify you own the repo
npx -y @lobehub/market-cli plugin submit ${submitUrl}
npx -y @lobehub/market-cli plugin list --output json   # import is async (~a few min)
\`\`\`

After that you self-manage everything — versions, metadata, delist, delete — via \`plugin publish\` / \`unpublish\` / \`delete\`. Full guide: **https://lobehub.com/publish-mcp/skill.md**

Self-publish works from a **GitHub repo you own**. Not your repo and you just want it indexed? Use the **"Request a Server"** button at **https://lobehub.com/mcp**.

I'll close this as a listing request — **if you think it was closed by mistake, just reopen this issue (or leave a comment) and we'll take another look.** The CLI just launched, so if you hit _any_ problem using it, a new issue is very welcome — that feedback is exactly what we want right now. Thanks! 🙏`;
}

async function ensureLabel(
  owner: string,
  repo: string,
  token: string,
  name: string,
  color: string,
  description: string,
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'auto-handle-mcp-submission-script',
      },
    },
  );

  if (res.ok) return;
  if (res.status !== 404) {
    throw new Error(`Checking label "${name}" failed: ${res.status} ${res.statusText}`);
  }

  console.log(`[INFO] Label "${name}" missing — creating it`);
  await githubRequest(`/repos/${owner}/${repo}/labels`, token, 'POST', {
    color,
    description,
    name,
  });
}

async function addLabel(
  owner: string,
  repo: string,
  token: string,
  issueNumber: number,
  name: string,
): Promise<void> {
  await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, token, 'POST', {
    labels: [name],
  });
  console.log(`[INFO] Added label "${name}"`);
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN environment variable is required');

  const owner = process.env.GITHUB_REPOSITORY_OWNER || 'lobehub';
  const repo = process.env.GITHUB_REPOSITORY_NAME || 'lobehub';
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  if (!issueNumber) throw new Error('ISSUE_NUMBER environment variable is required');

  console.log(`[INFO] Processing ${owner}/${repo}#${issueNumber}`);

  const issue = await githubRequest<GitHubIssue>(
    `/repos/${owner}/${repo}/issues/${issueNumber}`,
    token,
  );

  if (issue.state !== 'open') {
    console.log('[SKIP] Issue is not open');
    return;
  }

  // Idempotency is handled per-step below (label adds are idempotent, the close is a
  // no-op on an already-closed issue, and the redirect comment is guarded by its
  // marker), so a re-run after a partial failure safely completes the missing steps.
  const { delivery, isSubmission, reason, repoUrl } = classify(issue.title || '', issue.body || '');
  console.log(`[INFO] Classification: ${isSubmission ? 'SUBMISSION' : 'skip'} — ${reason}`);
  if (repoUrl) console.log(`[INFO] Extracted repo: ${repoUrl}`);

  if (!isSubmission) {
    console.log('[DONE] Not a listing request — leaving for normal triage');
    return;
  }

  // Every detected listing request gets the category label.
  await ensureLabel(owner, repo, token, LABEL, 'c5def5', 'MCP marketplace listing request');
  await addLabel(owner, repo, token, issueNumber, LABEL);

  // Remote-only or unknown-delivery servers cannot be self-published through the
  // CLI, so we must NOT send the "use the CLI" redirect or close them. Flag for a
  // maintainer and leave open.
  if (delivery !== 'local') {
    if (delivery === 'remote') {
      await ensureLabel(
        owner,
        repo,
        token,
        LABEL_REMOTE,
        'fbca04',
        'Remote-only MCP server — not self-serviceable via the CLI, needs manual handling',
      );
      await addLabel(owner, repo, token, issueNumber, LABEL_REMOTE);
    }
    console.log(
      `[DONE] ${delivery} delivery — left open for manual handling (no comment, no close)`,
    );
    return;
  }

  // Local / installable server — redirect to the self-service CLI and close.
  // Guard the comment with its marker so a re-run never double-posts.
  const comments = await githubRequest<GitHubComment[]>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    token,
  );
  if (comments.some((c) => (c.body || '').includes(MARKER))) {
    console.log('[INFO] Redirect comment already present — not reposting');
  } else {
    await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, 'POST', {
      body: buildComment(repoUrl),
    });
    console.log('[INFO] Posted CLI redirect comment');
  }

  // Closing an already-closed issue is a harmless no-op, so this step is re-run safe.
  await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, 'PATCH', {
    state: 'closed',
    state_reason: 'not_planned',
  });
  console.log(`[SUCCESS] Closed #${issueNumber} (local submission) as not planned`);
}

// Run only when executed directly, so `classify`/`extractRepoUrl` can be
// imported by unit tests without firing the GitHub side effects.
// @ts-ignore - import.meta.main is provided by Bun
if (import.meta.main) {
  main().catch((error) => {
    console.error(`[ERROR] ${error}`);
    process.exitCode = 1;
  });
}

export { classify, extractRepoUrl } from './shared/mcp-submission-classifier';
