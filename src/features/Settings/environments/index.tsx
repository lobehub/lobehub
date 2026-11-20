'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentDetailPage from '@/features/EnvironmentManager/EnvironmentDetailPage';
import PageTabs from '@/features/EnvironmentsAndCreds/PageTabs';
import PersonalVault from '@/features/EnvironmentsAndCreds/PersonalVault';
import { usePageTab } from '@/features/EnvironmentsAndCreds/usePageTab';

/**
 * Environments & Vault, personal: `/settings/environments` has two tabs, the
 * caller's environments and their personal vault (`?tab=vault`) — the
 * definitions a run starts from and the secrets it reads, in one place.
 * `/settings/environments/:sub` is one environment's page.
 *
 * No gate: an environment is a definition, and writing one down needs no
 * drive. Only initializing a folder from it does, and that is asked where it
 * happens.
 */
const Page = memo(() => {
  const { sub: environmentId } = useParams<{ sub?: string }>();
  // Personal-only route: plain `navigate` keeps it out of any active workspace.
  const navigate = useNavigate();
  const [tab, setTab] = usePageTab();

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

  const tabs = <PageTabs value={tab} onChange={setTab} />;

  return (
    <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
      {tab === 'vault' ? (
        <PersonalVault headerLeading={tabs} />
      ) : (
        <EnvironmentManager
          headerLeading={tabs}
          onOpenEnvironment={(id) => navigate(`/settings/environments/${encodeURIComponent(id)}`)}
        />
      )}
    </Flexbox>
  );
});

Page.displayName = 'EnvironmentsSetting';

export default Page;
