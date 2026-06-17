import { INBOX_SESSION_ID } from '@lobechat/const';
import { useParams } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

/**
 * The agentId of the current `/agent/:aid/*` route.
 *
 * Use this (instead of the global, hijack-prone `agentStore.activeAgentId`) to
 * scope `*ById` selectors in agent route components — sidebar, header, profile.
 * `AgentIdSync` redirects builtin slugs to their real id, but resolve the inbox
 * slug here too so the very first render before the redirect still works.
 */
export const useRouteAgentId = (): string => {
  const { aid } = useParams<{ aid?: string }>();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  return (aid === INBOX_SESSION_ID ? inboxAgentId : aid) || '';
};
