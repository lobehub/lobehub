export interface ParsedGithubRepository {
  /** `owner/name`. */
  fullName: string;
  /** The repository name alone, which the project is named after. */
  name: string;
  /** Canonical `https://github.com/owner/name`, the form an environment stores. */
  url: string;
}

const SEGMENT = /^[\w.-]+$/;

/**
 * Read a pasted GitHub repository reference: an https URL (with or without
 * `.git` or a trailing slash), an ssh `git@github.com:` remote, or bare
 * `owner/name`. Anything else — another host, a deep link into the tree,
 * embedded credentials — is not something an environment can clone, so it
 * yields `null` rather than a guess.
 */
export const parseGithubRepository = (value: string): ParsedGithubRepository | null => {
  const raw = value.trim();
  if (!raw) return null;

  let path: string | undefined;
  const ssh = /^git@github\.com:(.+)$/.exec(raw);
  if (ssh) path = ssh[1];
  else if (/^[\w.-]+\/[\w.-]+$/.test(raw)) path = raw;
  else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    path = url.pathname.replace(/^\//, '');
  }

  const [owner, repo, ...rest] = path
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
    .split('/');
  if (rest.length > 0 || !owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo))
    return null;

  return { fullName: `${owner}/${repo}`, name: repo, url: `https://github.com/${owner}/${repo}` };
};
