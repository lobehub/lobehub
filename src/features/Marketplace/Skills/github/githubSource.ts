/** A GitHub repository, optionally narrowed to a ref and a folder, as the importer reads it. */
export interface GithubSource {
  owner: string;
  /** Folder inside the repository; absent for the whole repository. */
  path?: string;
  /** Branch, tag or commit; absent for the default branch. */
  ref?: string;
  repo: string;
  /** The `https://github.com/…` address the server's GitHub importer takes. */
  url: string;
}

const NAME = /^[\w.-]+$/;

/** `npx skills add owner/repo --skill x`, and the same through bunx, pnpm dlx, yarn dlx. */
const SKILLS_COMMAND =
  /^(?:npx|bunx|pnpx|pnpm\s+dlx|yarn\s+dlx|bun\s+x)\s+(?:-y\s+)?skills(?:@\S+)?\s+add\s+(\S+)/i;

const build = (owner: string, repo: string, ref?: string, path?: string): GithubSource | null => {
  const name = repo.replace(/\.git$/i, '');
  if (!NAME.test(owner) || !NAME.test(name) || name === '.' || name === '..') return null;
  const folder = path?.replace(/\/SKILL\.md$/i, '').replaceAll(/^\/+|\/+$/g, '') || undefined;
  const branch = ref && ref !== 'HEAD' ? ref : undefined;
  const base = `https://github.com/${owner}/${name}`;
  const url = folder
    ? `${base}/tree/${branch ?? 'HEAD'}/${folder}`
    : branch
      ? `${base}/tree/${branch}`
      : base;
  return { owner, path: folder, ref: branch, repo: name, url };
};

/**
 * Reads what a person pastes or types as a GitHub skill source: `owner/repo`,
 * `github.com/owner/repo`, a full URL down to a `/tree/<ref>/<folder>` or a
 * `/blob/<ref>/<folder>/SKILL.md`, `git@github.com:owner/repo.git`, or an
 * `npx skills add owner/repo` command. Anything else (a plain search word,
 * another host) is `null`.
 */
export const parseGithubSource = (input: string): GithubSource | null => {
  let text = input.trim();
  if (!text) return null;

  const command = text.match(SKILLS_COMMAND);
  if (command) text = command[1];

  const ssh = text.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)\/?$/i);
  if (ssh) return build(ssh[1], ssh[2]);

  // Bare `owner/repo`. A third segment would be ambiguous with a search phrase.
  const short = text.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return build(short[1], short[2]);

  let address = text;
  if (/^(?:www\.)?github\.com\//i.test(address)) address = 'https://' + address;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) return null;

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) return null;
  const [owner, repo, kind, ref, ...rest] = parts;
  if (kind === 'tree' || kind === 'blob')
    return ref ? build(owner, repo, ref, rest.join('/')) : null;
  return build(owner, repo);
};
