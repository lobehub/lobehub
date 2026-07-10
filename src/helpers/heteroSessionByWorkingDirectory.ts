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

export const setHeteroSessionIdForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  workingDirectory: string | undefined,
  sessionId: string,
): Record<string, string> => ({
  ...metadata?.heteroSessionIdByWorkingDirectory,
  [getHeteroWorkingDirectoryKey(workingDirectory)]: sessionId,
});

export const removeHeteroSessionIdForWorkingDirectory = (
  metadata: ChatTopicMetadata | undefined,
  workingDirectory: string | undefined,
): Record<string, string> => {
  const next = { ...metadata?.heteroSessionIdByWorkingDirectory };
  delete next[getHeteroWorkingDirectoryKey(workingDirectory)];
  return next;
};
