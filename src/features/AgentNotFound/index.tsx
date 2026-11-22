'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { Button } from '@lobehub/ui';
import { type FC, memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import NotFound from '@/components/404';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const BUILTIN_SLUG_SET = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

interface AgentNotFoundProps {
  /**
   * Offer a way out to the Agent list. Off for hosts that must not navigate
   * the page away (popup windows, side panels).
   */
  showAgentList?: boolean;
}

/**
 * Terminal card for an agent whose config fetch settled on `null` — it
 * doesn't exist or the viewer has no access (e.g. another member's private
 * agent). Both cases share one message so the card never reveals that a
 * private id exists. Nothing here is retryable, so the only action leaves.
 */
export const AgentNotFound = memo<AgentNotFoundProps>(({ showAgentList }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  // Only a workspace has other members' private agents to ask about.
  const inWorkspace = !!useActiveWorkspaceId();

  return (
    <NotFound
      hideCheck
      hideWatermark
      desc={t(inWorkspace ? 'agentNotFound.desc' : 'agentNotFound.descPersonal')}
      title={t('agentNotFound.title')}
      extra={
        showAgentList ? (
          <Button type={'primary'} onClick={() => navigate('/agents')}>
            {t('agentNotFound.viewAgents')}
          </Button>
        ) : (
          // An empty fragment suppresses NotFound's default full-page "Back to Home" reload.
          <></>
        )
      }
    />
  );
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
export const AgentNotFoundGuard: FC<PropsWithChildren<AgentNotFoundProps>> = memo(
  ({ children, showAgentList }) => {
    const params = useParams<{ aid?: string }>();
    const aid = params.aid && !BUILTIN_SLUG_SET.has(params.aid) ? params.aid : '';
    const isNotFound = useAgentStore(agentByIdSelectors.isAgentNotFoundById(aid));

    if (isNotFound) return <AgentNotFound showAgentList={showAgentList} />;

    return children;
  },
);

AgentNotFoundGuard.displayName = 'AgentNotFoundGuard';
