export type AgentListContentState = 'inbox' | 'loading' | 'ready';

interface ResolveAgentListContentStateParams {
  authLoaded: boolean;
  isInit: boolean;
  isLogin: boolean;
}

export const resolveAgentListContentState = ({
  authLoaded,
  isInit,
  isLogin,
}: ResolveAgentListContentStateParams): AgentListContentState => {
  if (isInit) return 'ready';
  if (authLoaded && !isLogin) return 'inbox';
  return 'loading';
};
