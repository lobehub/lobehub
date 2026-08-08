#!/usr/bin/env bun
/**
 * Auto-handle MCP marketplace listing issues (new listing + rescan/refresh).
 *
 * Listing and refresh requests are self-service via @lobehub/market-cli.
 * When an issue matches, we label it `mcp:submission`, post a CLI redirect
 * comment, and close it as `not_planned`. Authors can reopen if it was closed
 * by mistake, or open a new issue if the CLI cannot complete the task.
 *
 * Product bugs and CLI feedback are left for normal triage.
 */

import {
  MCP_LABEL_COLORS,
  MCP_LABEL_DESCRIPTIONS,
  MCP_SUBMISSION_LABEL,
} from './shared/mcp-labels';
import { classify } from './shared/mcp-submission-classifier';

declare global {
  // @ts-ignore
  var process: {
    env: Record<string, string | undefined>;
    exitCode?: number;
  };
}

const MARKER = '<!-- bot:mcp-submission -->';
const REPO_PLACEHOLDER = 'https://github.com/<owner>/<repo>';
const PUBLISH_SKILL_URL = 'https://lobehub.com/publish-mcp/skill.md';

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

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function buildComment(repoUrl: string | null): string {
  const submitUrl = repoUrl ?? REPO_PLACEHOLDER;

  return `${MARKER}
👋 Thanks for this! **MCP marketplace listing and refresh requests are self-service** — please use the official CLI instead of GitHub issues. You can list a new server, claim an existing one, and publish version/metadata updates yourself without waiting on us.

### Easiest — let your coding agent do it

Paste this into Claude Code / Cursor / Codex / etc.:

\`\`\`text
Read ${PUBLISH_SKILL_URL} and follow the instructions to publish (or refresh) my MCP server on the LobeHub Marketplace
\`\`\`

### Or run the CLI yourself (Node.js ≥ 22)

\`\`\`bash
# 1. Login + link GitHub (browser, once)
npx -y @lobehub/market-cli login
npx -y @lobehub/market-cli github connect

# 2a. New listing — submit a GitHub repo you own (or have push access to).
#     Private repos work too after \`github connect\`. Replace the URL if needed.
npx -y @lobehub/market-cli plugin submit ${submitUrl}
# Import is async (~a few minutes). Track with:
npx -y @lobehub/market-cli plugin list --output json

# 2b. Already listed — claim it, then publish an updated version / metadata
#     (from a directory that has lhm.plugin.json)
npx -y @lobehub/market-cli plugin claim <identifier>
npx -y @lobehub/market-cli plugin publish --dir /absolute/path/to/your-mcp
\`\`\`

If the CLI fails (claim/submit stuck, docs wrong, etc.), **open a new issue** with the command you ran and the full error output — that feedback is welcome.

I'll close this as a marketplace listing request. **If it was closed by mistake, reopen or comment and we'll take another look.** Thanks! 🙏`;
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

  // Idempotency: label add is safe to re-run, close is a no-op when already closed,
  // and the redirect comment is guarded by its marker.
  const { isSubmission, reason, repoUrl } = classify(issue.title || '', issue.body || '');
  console.log(`[INFO] Classification: isSubmission=${isSubmission} — ${reason}`);
  if (repoUrl) console.log(`[INFO] Extracted repo: ${repoUrl}`);

  if (!isSubmission) {
    console.log('[DONE] Not a marketplace listing request — leaving for normal triage');
    return;
  }

  await ensureLabel(
    owner,
    repo,
    token,
    MCP_SUBMISSION_LABEL,
    MCP_LABEL_COLORS.submission,
    MCP_LABEL_DESCRIPTIONS.submission,
  );
  await addLabel(owner, repo, token, issueNumber, MCP_SUBMISSION_LABEL);

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

  await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, 'PATCH', {
    state: 'closed',
    state_reason: 'not_planned',
  });
  console.log(`[SUCCESS] Closed #${issueNumber} (marketplace listing request) as not planned`);
}

// @ts-ignore - import.meta.main is provided by Bun
if (import.meta.main) {
  main().catch((error) => {
    console.error(`[ERROR] ${error}`);
    process.exitCode = 1;
  });
}

export { classify, extractRepoUrl } from './shared/mcp-submission-classifier';
