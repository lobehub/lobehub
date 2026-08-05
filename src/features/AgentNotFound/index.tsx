'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { type FC, memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import NotFound from '@/components/404';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const BUILTIN_SLUG_SET = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Terminal 404 card for an agent whose config fetch settled on `null` — it
 * doesn't exist or the viewer lost access (e.g. a workspace agent switched
 * back to private by its owner).
 */
export const AgentNotFound = memo(() => {
  const { t } = useTranslation('chat');

  return <NotFound hideWatermark desc={t('agentNotFound.desc')} title={t('agentNotFound.title')} />;
});

AgentNotFound.displayName = 'AgentNotFound';

/**
 * Replaces children with the 404 card when the routed agent (`:aid`) resolved
 * to not-found / no-access. Builtin slugs are skipped: they are not real agent
 * ids (AgentIdSync redirects them to the resolved id), so a `null` fetch on
 * the slug key must not flash a 404.
 *
 * The not-found flag is cleared by any later successful fetch (e.g. the agent
 * is made public again), so the guard recovers without a manual refresh.
 */
export const AgentNotFoundGuard: FC<PropsWithChildren> = memo(({ children }) => {
  const params = useParams<{ aid?: string }>();
  const aid = params.aid && !BUILTIN_SLUG_SET.has(params.aid) ? params.aid : '';
  const isNotFound = useAgentStore(agentByIdSelectors.isAgentNotFoundById(aid));

  if (isNotFound) return <AgentNotFound />;

  return children;
});

AgentNotFoundGuard.displayName = 'AgentNotFoundGuard';
