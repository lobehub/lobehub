'use client';

import { Avatar } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import ShareShell, { ShareHero } from '@/business/client/features/ShareShell';
import { sharedAgentDisplayName } from '@/features/AgentShareVisitor/displayName';
import { useSharedAgent } from '@/features/AgentShareVisitor/useSharedAgent';

import { clientOnly } from '../../shell/clientOnly';
import { shouldShowSharedAgentLoader } from './loading';

const SharedAgentBody = clientOnly(() => import('./SharedAgentBody.client'));

const SharedAgentView = memo(() => {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useSharedAgent(id);
  const hero =
    data && !data.isOwner ? (
      <ShareHero
        byline={data.agentMeta.description}
        title={sharedAgentDisplayName(data.agentMeta)}
        avatar={
          <Avatar
            avatar={data.agentMeta.avatar ?? undefined}
            background={data.agentMeta.backgroundColor ?? undefined}
            size={40}
          />
        }
      />
    ) : null;

  return (
    <ShareShell
      error={error}
      errorResource="agent"
      loading={!error && shouldShowSharedAgentLoader({ hasData: Boolean(data), isLoading })}
    >
      {data ? <SharedAgentBody data={data} fallback={hero} /> : null}
    </ShareShell>
  );
});

SharedAgentView.displayName = 'SharedAgentView';

export default SharedAgentView;
