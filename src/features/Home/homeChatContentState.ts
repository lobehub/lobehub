export type HomeChatContentState = 'empty' | 'error' | 'loading' | 'ready';

interface ResolveHomeChatContentStateParams {
  authLoaded: boolean;
  hasError: boolean;
  isLogin: boolean;
  recentsCount: number;
  recentsInit: boolean;
  runningCount: number;
  runningResolved: boolean;
}

export const resolveHomeChatContentState = ({
  authLoaded,
  hasError,
  isLogin,
  recentsCount,
  recentsInit,
  runningCount,
  runningResolved,
}: ResolveHomeChatContentStateParams): HomeChatContentState => {
  if (!authLoaded) return 'loading';
  if (!isLogin) return 'empty';
  if (hasError && !recentsInit) return 'error';
  if (!recentsInit) return 'loading';
  if (recentsCount === 0 && runningCount === 0 && !runningResolved) return 'loading';
  if (recentsCount === 0 && runningCount === 0) return 'empty';
  return 'ready';
};
