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
