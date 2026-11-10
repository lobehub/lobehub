import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';
import { useMemo, useRef } from 'react';
import { useParams } from 'react-router';

import type { ConversationHooks } from '@/features/Conversation/types';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { looksLikeSlug } from './useResolvedAgentRouteId';

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/** `ok`: send; `moved`: the slug names another agent now; `unconfirmed`: the lookup failed. */
export type SlugRouteSendCheck = 'moved' | 'ok' | 'unconfirmed';

/**
 * Whether a send on `/agent/<slug>` may go to the agent on screen.
 *
 * A user-chosen slug paints its agent from the persisted `slug → id` before the
 * lookup answers, and a slug can move to another agent between sessions. Until
 * the server confirms the slug, a send waits for that answer and goes through
 * only when it names the agent the conversation shows; otherwise the route is
 * about to switch agents and the draft stays in the composer.
 */
export const checkSendOnSlugRoute = async (
  slug: string | undefined,
): Promise<SlugRouteSendCheck> => {
  if (!slug || builtinAgentSlugs.has(slug) || !looksLikeSlug(slug)) return 'ok';

  const state = useAgentStore.getState();
  if (agentSelectors.isAgentSlugConfirmed(slug)(state)) return 'ok';

  const shownAgentId = agentSelectors.getAgentIdBySlug(slug)(state);

  try {
    const confirmedAgentId = await state.confirmAgentSlugTarget(slug);
    if (!shownAgentId || !confirmedAgentId) return 'unconfirmed';
    return confirmedAgentId === shownAgentId ? 'ok' : 'moved';
  } catch {
    return 'unconfirmed';
  }
};

/**
 * Conversation hooks that hold every generation on an unconfirmed slug route
 * (see `checkSendOnSlugRoute`): a send, a regenerate and a continue would all
 * run against the agent painted from the local copy.
 */
export const useSlugRouteSendGuard = (): ConversationHooks => {
  const { aid } = useParams<{ aid?: string }>();
  const aidRef = useRef(aid);
  aidRef.current = aid;

  return useMemo(() => {
    const guard = async (): Promise<false | undefined> => {
      const check = await checkSendOnSlugRoute(aidRef.current);
      if (check === 'ok') return;

      // Nothing is lost (a draft stays in the composer); say why, so the action never looks dead.
      if (check === 'moved') toast.info(t('input.agentSlugMoved', { ns: 'chat' }));
      else toast.error(t('input.agentSlugUnconfirmed', { ns: 'chat' }));
      return false;
    };

    return {
      onBeforeContinue: guard,
      onBeforeRegenerate: guard,
      onBeforeSendMessage: guard,
    };
  }, []);
};
