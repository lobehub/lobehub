import type { ChatTopicMetadata } from '@lobechat/types';

export const getHeteroWorkingDirectoryKey = (workingDirectory: string | undefined): string =>
  workingDirectory ?? '';

export const getHeteroSessionIdForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  workingDirectory: string | undefined,
): string | undefined => {
  const key = getHeteroWorkingDirectoryKey(workingDirectory);
  return metadata?.heteroSessionIdByWorkingDirectory?.[key];
};

export const getHeteroSessionBindingKeyForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  workingDirectory: string | undefined,
): string | undefined => {
  const key = getHeteroWorkingDirectoryKey(workingDirectory);
  return metadata?.heteroSessionBindingKeyByWorkingDirectory?.[key];
};

export const setHeteroSessionIdForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  workingDirectory: string | undefined,
  sessionId: string,
): Record<string, string> => ({
  ...metadata?.heteroSessionIdByWorkingDirectory,
  [getHeteroWorkingDirectoryKey(workingDirectory)]: sessionId,
});

export const setHeteroSessionBindingKeyForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  workingDirectory: string | undefined,
  bindingKey: string,
): Record<string, string> => ({
  ...metadata?.heteroSessionBindingKeyByWorkingDirectory,
  [getHeteroWorkingDirectoryKey(workingDirectory)]: bindingKey,
});

export const removeHeteroSessionIdForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  workingDirectory: string | undefined,
): Record<string, string> => {
  const next = { ...metadata?.heteroSessionIdByWorkingDirectory };
  delete next[getHeteroWorkingDirectoryKey(workingDirectory)];
  return next;
};

export const removeHeteroSessionBindingKeyForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  workingDirectory: string | undefined,
): Record<string, string> => {
  const next = { ...metadata?.heteroSessionBindingKeyByWorkingDirectory };
  delete next[getHeteroWorkingDirectoryKey(workingDirectory)];
  return next;
};

/**
 * Move the session recorded for one cwd onto another — for the moves the CLI
 * makes *itself* during a turn (`EnterWorktree` / `ExitWorktree`), where the
 * result message states the session now works in the new directory. The session
 * id and its binding key travel together and the old key is dropped, so the
 * record follows the session instead of being duplicated onto two directories.
 *
 * Returns undefined when the two keys are equal or nothing was recorded for the
 * source, so a caller can skip the write entirely rather than materialise empty
 * maps.
 */
export const moveHeteroSessionForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  from: string | undefined,
  to: string | undefined,
):
  | Pick<
      ChatTopicMetadata,
      'heteroSessionBindingKeyByWorkingDirectory' | 'heteroSessionIdByWorkingDirectory'
    >
  | undefined => {
  const fromKey = getHeteroWorkingDirectoryKey(from);
  const toKey = getHeteroWorkingDirectoryKey(to);
  if (fromKey === toKey) return undefined;

  const sessions = { ...metadata?.heteroSessionIdByWorkingDirectory };
  const bindings = { ...metadata?.heteroSessionBindingKeyByWorkingDirectory };
  const sessionId = sessions[fromKey];
  const bindingKey = bindings[fromKey];
  if (!sessionId && !bindingKey) return undefined;

  delete sessions[fromKey];
  delete bindings[fromKey];
  if (sessionId) sessions[toKey] = sessionId;
  if (bindingKey) bindings[toKey] = bindingKey;

  return {
    heteroSessionBindingKeyByWorkingDirectory: bindings,
    heteroSessionIdByWorkingDirectory: sessions,
  };
};
