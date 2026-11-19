'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentDetailPage from '@/features/EnvironmentManager/EnvironmentDetailPage';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * The workspace's environments in one list: what members have published, and
 * the caller's own private ones, marked with a lock. Running in a published
 * one means running in its instances, which carry whatever a session left in
 * them.
 *
 * A new environment starts private, so creating one cannot quietly publish
 * it; its row menu publishes it.
 */
const WorkspaceEnvironmentsSetting = memo(() => {
  const { t } = useTranslation('setting');
  const { sub: environmentId } = useParams<{ sub?: string }>();
  const navigate = useWorkspaceAwareNavigate();

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
        createVisibility={'private'}
        headerLeading={
          <Text fontSize={13} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
            {t('environments.workspaceListDesc')}
          </Text>
        }
        onOpenEnvironment={(id) => navigate(`/settings/environments/${encodeURIComponent(id)}`)}
      />
    </Flexbox>
  );
});

WorkspaceEnvironmentsSetting.displayName = 'WorkspaceEnvironmentsSetting';

export default WorkspaceEnvironmentsSetting;
