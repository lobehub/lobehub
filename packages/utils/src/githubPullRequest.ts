/** A github.com PR page, including its tabs, query parameters and fragment. */
const PULL_REQUEST_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]\S*)?$/i;

export const parsePullRequestUrl = (url: string) => {
  const match = PULL_REQUEST_URL.exec(url.trim());
  if (!match) return null;

  const repoFullName = `${match[1]}/${match[2]}`;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return {
    identifier: `${repoFullName}#${number}`,
    number,
    repoFullName,
    url: `https://github.com/${repoFullName}/pull/${number}`,
  };
};
