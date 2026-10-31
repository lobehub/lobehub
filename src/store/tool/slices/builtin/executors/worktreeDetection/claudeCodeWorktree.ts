import { getWorkingDirSourcePath } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { topicSelectors } from '@/store/chat/selectors';
import { getChatStoreState } from '@/store/chat/store';

import {
  applyWorktreeAddToConfig,
  applyWorktreeExitToConfig,
  type WorktreeAddInfo,
} from './configTransitions';
import { normalizeBranch } from './utils';

/**
 * Claude Code's `EnterWorktree` / `ExitWorktree` move the session without ever
 * shelling out, so the `git worktree add` sniffing in `index.ts` cannot see them. Their
 * tool_result ships only CC's `message` string (the structured `worktreePath`
 * never leaves the tool), which makes these sentences the wire contract.
 */
const CC_ENTER_PATTERN = /^(?:Created|Entered) worktree at (.+?)(?: on branch (\S+))?\. /;
const CC_EXIT_PATTERN = /^Exited\b/;
/**
 * Said only on the branch that `chdir`s the SESSION into the worktree. A subagent
 * pinned to its own cwd gets "This agent's working directory …" instead, because it
 * moved only itself — recording that would claim the whole run had relocated.
 * Requiring this sentence fails CLOSED: if CC rewords it we stop recording, rather
 * than record a worktree the session is not in.
 */
const CC_SESSION_ENTER_MARKER = 'The session is now working in the worktree';

/**
 * Read the worktree CC entered out of `EnterWorktree`'s result message:
 *
 *   `${'Created' | 'Entered'} worktree at ${path}[ on branch ${branch}]. The session…`
 *
 * The path is delimited by ` on branch <ref>` or the `. ` before the next sentence,
 * so a path containing spaces survives; one containing `". "` would not. Returns
 * undefined unless the SESSION moved (see {@link CC_SESSION_ENTER_MARKER}).
 */
export const parseWorktreeEnterInfo = (content?: string): WorktreeAddInfo | undefined => {
  if (!content?.includes(CC_SESSION_ENTER_MARKER)) return undefined;

  const match = CC_ENTER_PATTERN.exec(content);
  const path = match?.[1]?.trim();
  if (!path) return undefined;

  const branch = normalizeBranch(match?.[2]);
  return { ...(branch ? { branch } : {}), path };
};

/**
 * Every successful `ExitWorktree` outcome — kept, removed, or "could not remove it"
 * — opens with `Exited …`, and all three leave the session back in its original
 * directory. The no-op ("no active EnterWorktree session") and the refusals are
 * validation failures, so they arrive with `success: false` and never get here.
 */
export const isWorktreeExitContent = (content?: string): boolean =>
  !!content && CC_EXIT_PATTERN.test(content);

/**
 * Record a successful `EnterWorktree` as the run topic's active worktree. Unlike
 * `git worktree add`, the path is never in the arguments — a bare call generates a
 * random name — so it is read back out of the result message.
 */
export const recordWorktreeEnter = async (params: {
  content?: string;
  topicId: string;
}): Promise<void> => {
  const { content, topicId } = params;
  const state = getChatStoreState();

  const topic = topicSelectors.getTopicById(topicId)(state);
  const currentConfig = topic?.metadata?.workingDirectoryConfig;
  const source = getWorkingDirSourcePath(currentConfig) ?? topic?.metadata?.workingDirectory;

  const worktreeInfo = parseWorktreeEnterInfo(content);
  if (!worktreeInfo || !source || worktreeInfo.path === source) return;

  const nextConfig = applyWorktreeAddToConfig(currentConfig, source, worktreeInfo);

  if (isEqual(currentConfig, nextConfig)) return;
  await state.updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
};

/**
 * Record a successful `ExitWorktree` — the session is back in its original directory,
 * so the topic drops its worktree whether it was kept on disk or removed. Keeping it
 * would leave the topic pointing at a directory the run has left (and, on `remove`,
 * one that no longer exists).
 */
export const recordWorktreeExit = async (params: {
  content?: string;
  topicId: string;
}): Promise<void> => {
  const { content, topicId } = params;
  if (!isWorktreeExitContent(content)) return;

  const state = getChatStoreState();

  const topic = topicSelectors.getTopicById(topicId)(state);
  const currentConfig = topic?.metadata?.workingDirectoryConfig;
  const source = getWorkingDirSourcePath(currentConfig) ?? topic?.metadata?.workingDirectory;
  if (!source) return;

  // Never in a worktree → nothing to clear, and don't materialize an empty `git`.
  const currentGit = currentConfig?.git;
  if (!currentGit?.activeWorktree && !currentGit?.isWorktree) return;

  const nextConfig = applyWorktreeExitToConfig(currentConfig, source);

  if (isEqual(currentConfig, nextConfig)) return;
  await state.updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
};
