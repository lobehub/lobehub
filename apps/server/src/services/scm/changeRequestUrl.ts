import type { ScmProvider } from '@lobechat/types';

export interface ParsedChangeRequestUrl {
  number: number;
  provider: ScmProvider;
  repoFullName: string;
  /** Canonical form, without any trailing tab path, query or fragment. */
  url: string;
}

const GITHUB_PULL_PATH = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/.*)?$/;

/**
 * The change request a web URL names, or `null` when it names none. Only
 * github.com pull requests today, matching `SCM_PROVIDERS`; a link to a
 * PR's "Files changed" tab still names the PR.
 */
export const parseChangeRequestUrl = (value: string): ParsedChangeRequestUrl | null => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null;

  const match = GITHUB_PULL_PATH.exec(url.pathname);
  if (!match) return null;
  const [, owner, repo, rawNumber] = match;
  const number = Number(rawNumber);
  if (!Number.isSafeInteger(number) || number <= 0) return null;

  const repoFullName = `${owner}/${repo}`;
  return {
    number,
    provider: 'github',
    repoFullName,
    url: `https://github.com/${repoFullName}/pull/${number}`,
  };
};
