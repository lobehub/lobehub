/**
 * Git repo-type / gitdir helpers. The implementations now live in
 * `@lobechat/local-file-shell` so desktop, the device RPC, and the CLI share one
 * copy; re-exported here to keep existing `@/utils/git` import sites stable.
 */
export { detectRepoType, resolveCommonGitDir, resolveGitDir } from '@lobechat/local-file-shell';
