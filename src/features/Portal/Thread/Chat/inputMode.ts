export type ThreadInputMode = 'default' | 'heterogeneous' | 'hidden';

export const getThreadInputMode = ({
  isExternallyOwnedThread,
  isHeterogeneousAgent,
}: {
  isExternallyOwnedThread: boolean;
  isHeterogeneousAgent: boolean;
}): ThreadInputMode => {
  if (isExternallyOwnedThread) return 'hidden';

  return isHeterogeneousAgent ? 'heterogeneous' : 'default';
};
