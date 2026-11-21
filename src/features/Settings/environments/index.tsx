'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentDetailPage from '@/features/EnvironmentManager/EnvironmentDetailPage';
import { TAB_PARAM } from '@/features/EnvironmentsAndCreds/const';

/**
 * `/settings/environments` lists the caller's environments;
 * `/settings/environments/:sub` is one environment's page. The personal vault
 * has its own settings entry (`/settings/credential`); links to the former
 * vault tab (`?tab=vault`) open it.
 *
 * No gate: an environment is a definition, and writing one down needs no
 * drive. Only initializing a folder from it does, and that is asked where it
 * happens.
 */
const Page = memo(() => {
  const { sub: environmentId } = useParams<{ sub?: string }>();
  // Personal-only route: plain `navigate` keeps it out of any active workspace.
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  if (searchParams.get(TAB_PARAM) === 'vault')
    return <Navigate replace to={'/settings/credential'} />;

  if (environmentId)
    return (
      <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
        <EnvironmentDetailPage
          environmentId={environmentId}
          key={environmentId}
          onBack={() => navigate('/settings/environments')}
        />
      </Flexbox>
    );

  return (
    <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
      <EnvironmentManager
        onOpenEnvironment={(id) => navigate(`/settings/environments/${encodeURIComponent(id)}`)}
      />
    </Flexbox>
  );
});

Page.displayName = 'EnvironmentsSetting';

export default Page;
