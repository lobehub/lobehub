export type HomeChatContentState = 'empty' | 'error' | 'loading' | 'ready';

interface ResolveHomeChatContentStateParams {
  activityCount: number;
  activityError: boolean;
  activityResolved: boolean;
  authLoaded: boolean;
  hasError: boolean;
  isLogin: boolean;
  recentsCount: number;
  recentsInit: boolean;
}

export const resolveHomeChatContentState = ({
  activityCount,
  activityError,
  activityResolved,
  authLoaded,
  hasError,
  isLogin,
  recentsCount,
  recentsInit,
}: ResolveHomeChatContentStateParams): HomeChatContentState => {
  if (!authLoaded) return 'loading';
  if (!isLogin) return 'empty';
  if (hasError && !recentsInit) return 'error';
  if (!recentsInit) return 'loading';
  if (activityError) return 'ready';
  if (recentsCount === 0 && activityCount === 0 && !activityResolved) return 'loading';
  if (recentsCount === 0 && activityCount === 0) return 'empty';
  return 'ready';
};

/**
 * Whether the recents block may trust its rows. A snapshot hydrated from local
 * storage is not the server's answer: rows paint at once, but an empty one only
 * counts as empty after the server confirmed it — otherwise the starters would
 * flash in front of an account that has topics.
 */
export const isRecentsSnapshotSettled = (
  rows: readonly unknown[] | undefined,
  confirmed: boolean,
): boolean => rows !== undefined && (rows.length > 0 || confirmed);
