import type { TfsCredentials } from '@lobechat/types';
import { parseTfsRepository } from '@lobechat/utils/tfs';

const quote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;
const hasControlCharacter = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export interface TfsGitOperation {
  branch: string;
  operation: 'fetch' | 'pull' | 'push';
}

/** Only a normal branch, never a refspec, revision expression or git option. */
export const isTfsGitBranch = (branch: string): boolean =>
  !!branch &&
  branch.length <= 255 &&
  !branch.startsWith('-') &&
  !branch.startsWith('/') &&
  !branch.endsWith('/') &&
  !branch.includes('..') &&
  !branch.includes('@{') &&
  !hasControlCharacter(branch) &&
  !/[\s~^:?*[\\]/.test(branch) &&
  branch
    .split('/')
    .every(
      (part) => !!part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'),
    );

export const tfsGitCredentialConfig = (auth: {
  tfs: TfsCredentials;
  urlPrefix: string;
}): [string, string][] => {
  const username = auth.tfs.authType === 'pat' ? 'tfs' : auth.tfs.username;
  const helper = `!f() { printf '%s\\n' ${quote(`username=${username}`)} ${quote(`password=${auth.tfs.secret}`)}; }; f`;
  return [
    ['credential.helper', ''],
    [`credential.${auth.urlPrefix}.helper`, helper],
    [`http.${auth.urlPrefix}.followRedirects`, 'false'],
  ];
};

/** No arbitrary shell, remote, hooks, force push or persistent credential configuration. */
export const buildTfsGitCommand = (
  input: TfsGitOperation & {
    credentials: TfsCredentials;
    path?: string;
    url: string;
  },
): string => {
  const repository = parseTfsRepository(input.url);
  if (!repository || !isTfsGitBranch(input.branch)) throw new Error('Invalid TFS Git target');
  const path = input.path ?? '.';
  if (
    path.startsWith('/') ||
    path.split('/').some((part) => part === '..') ||
    hasControlCharacter(path)
  )
    throw new Error('Invalid TFS checkout path');
  const config = [
    ...tfsGitCredentialConfig({ tfs: input.credentials, urlPrefix: repository.url }),
    ['core.hooksPath', '/dev/null'],
    ['credential.useHttpPath', 'true'],
    ['http.extraHeader', ''],
    ['http.proxy', ''],
    ['core.fsmonitor', 'false'],
    ['maintenance.auto', 'false'],
    ['gc.auto', '0'],
  ];
  const git = `git -C ${quote(path)}`;
  const ref = `refs/heads/${input.branch}`;
  const network =
    input.operation === 'push'
      ? `${git} push ${quote(repository.url)} ${quote(`HEAD:${ref}`)}`
      : `${git} fetch --no-tags ${quote(repository.url)} ${quote(ref)}`;
  return [
    '( set +x',
    'unset GIT_TRACE GIT_TRACE_PACKET GIT_TRACE_CURL GIT_CURL_VERBOSE GIT_TRACE_SETUP GIT_TRACE2 GIT_TRACE2_EVENT GIT_TRACE2_PERF',
    'export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null',
    `export GIT_CONFIG_COUNT=${config.length}`,
    ...config.flatMap(([key, value], index) => [
      `export GIT_CONFIG_KEY_${index}=${quote(key)}`,
      `export GIT_CONFIG_VALUE_${index}=${quote(value)}`,
    ]),
    // -P resolves symlinks before checking the source path remains in the topic folder.
    '__lobe_root=$(pwd -P)',
    `__lobe_repo=$(cd ${quote(path)} && pwd -P) || exit 1`,
    'case "$__lobe_repo/" in "$__lobe_root/"*) ;; *) echo "TFS checkout escapes the working folder" >&2; exit 1 ;; esac',
    `__lobe_top=$(${git} rev-parse --show-toplevel) || exit 1`,
    '[ "$__lobe_top" = "$__lobe_repo" ] || { echo "Selected source is not the checkout root" >&2; exit 1; }',
    `__lobe_git_dir=$(${git} rev-parse --absolute-git-dir) || exit 1`,
    '__lobe_git_dir=$(cd "$__lobe_git_dir" && pwd -P) || exit 1',
    'case "$__lobe_git_dir/" in "$__lobe_root/"*) ;; *) echo "Git metadata escapes the working folder" >&2; exit 1 ;; esac',
    `[ "$(${git} remote get-url origin)" = ${quote(repository.url)} ] || { echo "Checkout origin does not match the selected TFS source" >&2; exit 1; }`,
    `${network} || exit $?`,
    ...(input.operation === 'pull'
      ? [
          `unset GIT_CONFIG_COUNT ${config.flatMap((_, index) => [`GIT_CONFIG_KEY_${index}`, `GIT_CONFIG_VALUE_${index}`]).join(' ')}`,
          // Merge runs with hooks disabled and without the network credential in its environment.
          `${git} -c core.hooksPath=/dev/null merge --ff-only FETCH_HEAD`,
        ]
      : []),
    ')',
  ].join('\n');
};
