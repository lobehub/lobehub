import { parseShellCommandSegments } from './shellCommandParsing';

/** What a successful `git push` published, as its own output reported it. */
export interface GitPushResult {
  /** Branch names ON the remote that now hold the pushed commits. */
  branches: string[];
  /** `owner/repo` of the GitHub remote the push went to. */
  repoFullName: string;
}

/** `git` global options that consume the following token (`git -C dir push`). */
const GIT_GLOBAL_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

/** `-n` / `--dry-run`, also inside a short-flag cluster (`-un`): git prints the table but publishes nothing. */
const isDryRunFlag = (token: string) =>
  token === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(token);

/** A `git push` that publishes — a dry run reports the same table without pushing. */
const isGitPushSegment = (segment: string[]): boolean => {
  if (segment[0] !== 'git' && !segment[0]?.endsWith('/git')) return false;

  for (let i = 1; i < segment.length; i++) {
    const token = segment[i];
    if (GIT_GLOBAL_VALUE_FLAGS.has(token)) {
      i++;
      continue;
    }
    if (token.startsWith('-')) continue;
    return token === 'push' && !segment.slice(i + 1).some(isDryRunFlag);
  }
  return false;
};

/**
 * The `To <url>` header git prints above each remote's ref table. Only a
 * github.com remote names a repository we can link pull requests in.
 */
const PUSH_DESTINATION_LINE = /^To\s+(\S+)\s*$/;

/**
 * git anonymizes the URL it prints (`git@github.com:a/b.git` → `github.com:a/b.git`),
 * so the scp-like form is accepted with or without a user.
 */
const GITHUB_REMOTE_RE =
  /^(?:https?:\/\/(?:[^@/\s]+@)?github\.com\/|ssh:\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/|(?:[^@/\s]+@)?github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export const parseGithubRemoteUrl = (url: string): string | null => {
  const match = GITHUB_REMOTE_RE.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
};

/**
 * A ref line of git's push status table (`git push --porcelain` aside):
 *
 * ```
 *  * [new branch]      feat/x -> feat/x
 *    031bf96..f6b1c2a  local -> feat/y
 *  + 031bf96...f6b1c2a local -> feat/y (forced update)
 * ```
 *
 * Mirrors the client recorder (`worktreeDetection.parsePushRefMappings`): a
 * rejected, deleted or tag ref never counts as a published branch.
 */
const PUSH_REF_LINE =
  /^\s*(?:\S\s+)?(\[[^\]]*\]|[\da-f]{4,40}\.{2,3}[\da-f]{4,40})\s+(\S+)\s+->\s+(\S+)(?:\s+\(.*\))?\s*$/i;
const PUSH_SUCCESS_STATUS = /^\[(?:new branch|new reference|up to date)\]$/i;

/**
 * Parse a shell run that pushed to GitHub. Returns null unless the command
 * contains a `git push` AND its output names exactly one GitHub destination
 * with at least one published branch — a push to two remotes, or output with
 * no ref table (a quiet push, a failure), is not something we can attribute.
 */
export const parseGitPushResult = (params: {
  command: string;
  output?: string | null;
}): GitPushResult | null => {
  const segments = parseShellCommandSegments(params.command);
  if (!segments?.some(isGitPushSegment)) return null;
  if (!params.output) return null;

  const destinations = new Map<string, Set<string>>();
  let current: Set<string> | null = null;

  for (const line of params.output.split('\n')) {
    const destination = PUSH_DESTINATION_LINE.exec(line.trim());
    if (destination) {
      const repo = parseGithubRemoteUrl(destination[1]);
      current = repo ? (destinations.get(repo) ?? new Set<string>()) : null;
      if (repo && current) destinations.set(repo, current);
      continue;
    }
    if (!current) continue;

    const ref = PUSH_REF_LINE.exec(line);
    if (!ref) continue;
    const [, status, local, remote] = ref;
    if (status.startsWith('[') && !PUSH_SUCCESS_STATUS.test(status)) continue;
    if (local === '(none)' || local.startsWith('refs/tags/') || remote.startsWith('refs/tags/'))
      continue;
    current.add(remote.replace(/^refs\/heads\//, ''));
  }

  const published = [...destinations].filter(([, branches]) => branches.size > 0);
  if (published.length !== 1) return null;

  const [[repoFullName, branches]] = published;
  return { branches: [...branches], repoFullName };
};
