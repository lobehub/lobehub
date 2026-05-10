/**
 * Builds the system context injected before every user prompt for cloud Claude Code runs.
 *
 * This context is cloud-sandbox-specific: it describes the workspace layout,
 * lists the GitHub repos that were pre-cloned, and tells CC how to handle
 * repos that may not have been cloned successfully.
 *
 * It is NOT the agent's systemRole (which lives in agentConfig.systemRole and
 * is a user-facing persona definition). This is pure infra context for CC.
 *
 * Returned string is passed as the first text block in the --input-json array
 * via sandboxRunner → spawnHeteroSandbox. If nothing meaningful to inject,
 * returns undefined so no extra block is added.
 */
export function buildCloudHeteroContext(params: {
  repos: string[];
  /** Static systemContext from HeterogeneousProviderConfig.systemContext (agent-level). */
  agentSystemContext?: string;
  /** GitHub OAuth token injected as GITHUB_TOKEN env var in the sandbox. */
  githubToken?: string;
}): string {
  const { repos, agentSystemContext, githubToken } = params;

  const parts: string[] = [];

  // --- Agent-level static context (highest priority, goes first) ---
  if (agentSystemContext?.trim()) {
    parts.push(agentSystemContext.trim());
  }

  // --- Cloud workspace context ---
  const workspaceLines: string[] = [
    '## Cloud Workspace',
    'You are running inside a LobeHub cloud sandbox. Your working directory is `/workspace`.',
  ];

  if (githubToken) {
    workspaceLines.push(
      '',
      '## GitHub Authentication',
      'GitHub credentials are pre-injected into this sandbox:',
      '',
      '- `GITHUB_TOKEN` env var is set — git and `gh` CLI pick it up automatically',
      '- `gh` CLI is pre-authenticated — all `gh` commands work out of the box',
      '- `~/.creds/env` contains `GITHUB_ACCESS_TOKEN` (same format as `injectCredsToSandbox`)',
      '  — source it in sub-shells or scripts that need an explicit token:',
      '  ```bash',
      '  source ~/.creds/env',
      '  echo $GITHUB_ACCESS_TOKEN | gh auth login --hostname github.com --with-token',
      '  ```',
      '',
      'You can use `git push`, `git pull`, `gh pr create`, `gh issue list`, GitHub API calls, etc. directly.',
    );
  }

  if (repos.length > 0) {
    workspaceLines.push(
      '',
      '## GitHub Repositories',
      'The following repositories were pre-cloned into `/workspace` before this conversation started:',
      ...repos.map((repo) => {
        const dir = repoToLocalDir(repo);
        const url = toGithubUrl(repo);
        return `- \`/workspace/${dir}\`  (${url})`;
      }),
      '',
      'You can start working in any of these directories immediately.',
      githubToken
        ? 'If a directory is missing (clone may have failed), you can recover it yourself using the available GITHUB_TOKEN.'
        : 'If a directory is missing (clone may have failed), you can run `git clone <url> /workspace/<dir>` yourself to recover it.',
    );
  } else {
    workspaceLines.push(
      '',
      'No GitHub repositories have been pre-cloned for this conversation.',
      githubToken
        ? 'If you need a repository, you can clone it yourself using the available GITHUB_TOKEN.'
        : 'If you need a repository, ask the user to add it in the repo selector, or clone it yourself with `git clone <url> /workspace/<dir>`.',
    );
  }

  parts.push(workspaceLines.join('\n'));

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Helpers (mirrors sandboxRunner logic — kept local to avoid coupling)
// ---------------------------------------------------------------------------

function repoToLocalDir(repo: string): string {
  return (repo.split('/').findLast(Boolean) ?? repo).replace(/\.git$/, '');
}

function toGithubUrl(repo: string): string {
  if (repo.startsWith('http')) return repo.replace(/\.git$/, '');
  return `https://github.com/${repo}`;
}
