'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentDetailPage from '@/features/EnvironmentManager/EnvironmentDetailPage';

/**
 * `/settings/environments` lists them; `/settings/environments/:sub` is one
 * environment's page. The list's Refresh and New actions live in the manager.
 *
 * No gate: an environment is a definition, and writing one down needs no
 * drive. Only initializing a folder from it does, and that is asked where it
 * happens.
 */
const Page = memo(() => {
  const { sub: environmentId } = useParams<{ sub?: string }>();
  // Personal-only route: plain `navigate` keeps it out of any active workspace.
  const navigate = useNavigate();

  return (
    <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
      {environmentId ? (
        <EnvironmentDetailPage
          environmentId={environmentId}
          key={environmentId}
          onBack={() => navigate('/settings/environments')}
        />
      ) : (
        <EnvironmentManager
          onOpenEnvironment={(id) => navigate(`/settings/environments/${encodeURIComponent(id)}`)}
        />
      )}
    </Flexbox>
  );
});

Page.displayName = 'EnvironmentsSetting';

export default Page;
