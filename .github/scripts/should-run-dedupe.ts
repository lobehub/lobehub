#!/usr/bin/env bun

import { appendFile } from 'node:fs/promises';

import {
  MCP_LEGACY_REMOTE_LABEL,
  MCP_LEGACY_SUBMISSION_LABEL,
  MCP_MANUAL_REVIEW_LABEL,
  MCP_RESCAN_LABEL,
  MCP_SUBMISSION_LABEL,
} from './shared/mcp-labels';
import { classify } from './shared/mcp-submission-classifier';

interface GitHubLabel {
  name: string;
}

interface DedupeIssue {
  body: string | null;
  labels: GitHubLabel[];
  state: string;
  title: string;
}

interface DedupeDecision {
  reason: string;
  shouldDedupe: boolean;
}

const MCP_DEDUPE_SKIP_LABELS = [
  MCP_SUBMISSION_LABEL,
  MCP_MANUAL_REVIEW_LABEL,
  MCP_RESCAN_LABEL,
  MCP_LEGACY_SUBMISSION_LABEL,
  MCP_LEGACY_REMOTE_LABEL,
] as const;

async function githubRequest<T>(endpoint: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'should-run-dedupe-script',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API GET ${endpoint} failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function hasLabel(issue: DedupeIssue, name: string): boolean {
  return issue.labels.some((label) => label.name === name);
}

function githubOutputValue(value: string): string {
  return value.replaceAll('\n', ' ');
}

async function setGitHubOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  await appendFile(outputPath, `${name}=${githubOutputValue(value)}\n`);
}

export function shouldDedupeIssue(issue: DedupeIssue): DedupeDecision {
  if (issue.state !== 'open') {
    return {
      reason: 'Issue is not open',
      shouldDedupe: false,
    };
  }

  if (MCP_DEDUPE_SKIP_LABELS.some((label) => hasLabel(issue, label))) {
    return {
      reason: 'MCP marketplace listing request is handled by the MCP submission workflow',
      shouldDedupe: false,
    };
  }

  const classification = classify(issue.title || '', issue.body || '');
  if (classification.isSubmission) {
    return {
      reason: `MCP marketplace listing request (${classification.delivery}) is handled by the MCP submission workflow`,
      shouldDedupe: false,
    };
  }
  if (classification.kind === 'listing-ops') {
    return {
      reason: 'MCP listing rescan request is handled by the MCP submission workflow',
      shouldDedupe: false,
    };
  }

  return {
    reason: 'Issue is eligible for duplicate detection',
    shouldDedupe: true,
  };
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN environment variable is required');

  const repository = process.env.GITHUB_REPOSITORY;
  const [repositoryOwner, repositoryName] = repository?.split('/') ?? [];
  const owner = process.env.GITHUB_REPOSITORY_OWNER || repositoryOwner || 'lobehub';
  const repo = process.env.GITHUB_REPOSITORY_NAME || repositoryName || 'lobehub';
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  if (!issueNumber) throw new Error('ISSUE_NUMBER environment variable is required');

  const issue = await githubRequest<DedupeIssue>(
    `/repos/${owner}/${repo}/issues/${issueNumber}`,
    token,
  );
  const decision = shouldDedupeIssue(issue);

  console.log(
    `[INFO] Dedupe preflight for ${owner}/${repo}#${issueNumber}: ${
      decision.shouldDedupe ? 'run' : 'skip'
    } - ${decision.reason}`,
  );

  await setGitHubOutput('should_dedupe', String(decision.shouldDedupe));
  await setGitHubOutput('reason', decision.reason);
}

// @ts-ignore - import.meta.main is provided by Bun
if (import.meta.main) {
  main().catch((error) => {
    console.error(`[ERROR] ${error}`);
    process.exitCode = 1;
  });
}
