'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import ShareShell from '@/business/client/features/ShareShell';
import { useSharedAgent } from '@/features/AgentShareVisitor/useSharedAgent';

import { clientOnly } from '../../shell/clientOnly';
import { shouldShowSharedAgentLoader } from './loading';

const SharedAgentBody = clientOnly(() => import('./SharedAgentBody.client'));

const SharedAgentView = memo(() => {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useSharedAgent(id);

  return (
    <ShareShell
      error={error}
      errorResource="agent"
      loading={!error && shouldShowSharedAgentLoader({ hasData: Boolean(data), isLoading })}
    >
      <SharedAgentBody />
    </ShareShell>
  );
});

SharedAgentView.displayName = 'SharedAgentView';

export default SharedAgentView;
