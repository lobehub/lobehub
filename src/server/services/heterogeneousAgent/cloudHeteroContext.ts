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
    '',
    '## Sandbox Persistence — CRITICAL',
    'This sandbox is **ephemeral**: it will be destroyed after ~1 hour of inactivity.',
    '**Any file changes that are not pushed to a remote will be permanently lost.**',
    '',
    'Rules you MUST follow for every code change:',
    '',
    '1. **Always commit and push** — after making changes, run `git add`, `git commit`, and `git push`.',
    '   Never leave code changes uncommitted at the end of a task.',
    '2. **Confirm push success** — verify with `git log --oneline origin/<branch>`',
    '   before reporting a task as complete.',
    '3. **Never rely on local-only state** — treat every file in `/workspace` as temporary.',
    '   The source of truth is the remote GitHub repository.',
    '',
    '## Pushing to GitHub — Public vs Private Repos',
    '',
    'Before pushing, check whether the repo is public or private:',
    '```bash',
    'gh repo view <owner>/<repo> --json isPrivate --jq .isPrivate',
    '```',
    '',
    '**Private repo** — push directly to the origin remote:',
    '```bash',
    'git push origin <branch>',
    '```',
    '',
    '**Public repo** — you likely do not have write access. Fork first, then push:',
    '```bash',
    '# 1. Fork the repo to your account (idempotent — safe to run even if fork exists)',
    'gh repo fork <owner>/<repo> --clone=false',
    '# 2. Add the fork as a remote (idempotent — safe to re-run if remote already exists)',
    'GITHUB_USER=$(gh api user --jq .login)',
    'git remote set-url fork https://github.com/$GITHUB_USER/<repo>.git 2>/dev/null || git remote add fork https://github.com/$GITHUB_USER/<repo>.git',
    '# 3. Push to the fork',
    'git push fork <branch>',
    '# 4. Open a PR from the fork to the upstream repo',
    'gh pr create --repo <owner>/<repo> --head $GITHUB_USER:<branch> --title "..." --body "..."',
    '```',
    '',
    'If you are unsure whether you have push access, attempt `git push origin <branch>` first.',
    'If it fails with a 403 / permission denied error, fall back to the fork workflow above.',
    '',
    'If the user asks you to make code changes, the task is NOT complete until those changes',
    'are visible on GitHub (pushed to a branch or merged via PR).',
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
      '`gh` is the preferred tool for GitHub operations (PRs, issues, releases); use `git push` for pushing commits.',
      '',
      'If `git push` fails with an authentication error, recover with one of these approaches (in order of preference):',
      '1. `gh auth setup-git` — reconfigures git to use gh as credential helper, then retry `git push`',
      '2. `git push https://oauth2:$GITHUB_TOKEN@github.com/<owner>/<repo>.git <branch>` — inline token fallback',
      '',
      'Use `gh pr view` or `gh pr list` to confirm that a PR was successfully created after pushing.',
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
