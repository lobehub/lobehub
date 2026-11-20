'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentDetailPage from '@/features/EnvironmentManager/EnvironmentDetailPage';
import PageTabs from '@/features/EnvironmentsAndCreds/PageTabs';
import { usePageTab } from '@/features/EnvironmentsAndCreds/usePageTab';
import WorkspaceVault from '@/features/EnvironmentsAndCreds/WorkspaceVault';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * Environments & Vault, workspace: the environments and the credentials the
 * caller can use here, in two tabs (`?tab=vault` opens the vault). Each lists
 * what members have published together with the caller's own private items,
 * marked with a lock; each tab's header filter narrows it to everything, the
 * shared ones or the caller's private ones.
 *
 * New items start private, so creating one cannot quietly publish it; its row
 * menu publishes it.
 */
const WorkspaceEnvironmentsSetting = memo(() => {
  const { sub: environmentId } = useParams<{ sub?: string }>();
  const navigate = useWorkspaceAwareNavigate();
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
        <WorkspaceVault headerLeading={tabs} />
      ) : (
        <EnvironmentManager
          createVisibility={'private'}
          headerLeading={tabs}
          onOpenEnvironment={(id) => navigate(`/settings/environments/${encodeURIComponent(id)}`)}
        />
      )}
    </Flexbox>
  );
});

WorkspaceEnvironmentsSetting.displayName = 'WorkspaceEnvironmentsSetting';

export default WorkspaceEnvironmentsSetting;
