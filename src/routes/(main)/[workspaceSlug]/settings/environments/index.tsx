'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import VisibilityFilter, { type VisibilityFilterValue } from '@/components/VisibilityFilter';
import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentDetailPage from '@/features/EnvironmentManager/EnvironmentDetailPage';
import SectionTitle from '@/features/EnvironmentsAndCreds/SectionTitle';
import WorkspaceCredsSection from '@/features/EnvironmentsAndCreds/WorkspaceCredsSection';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * Environments & Credentials, workspace: the environments and credentials the
 * caller can use here, in two sections. Each lists what members have
 * published together with the caller's own private items, marked with a lock;
 * one header filter narrows both to everything, the shared ones or the
 * caller's private ones.
 *
 * New items start private, so creating one cannot quietly publish it; its row
 * menu publishes it.
 */
const WorkspaceEnvironmentsSetting = memo(() => {
  const { t } = useTranslation('setting');
  const { sub: environmentId } = useParams<{ sub?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilterValue>('all');

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
    <Flexbox gap={32} style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Text fontSize={13} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
          {t('environmentsAndCreds.workspaceDesc')}
        </Text>
        <Flexbox style={{ flex: 'none' }}>
          <VisibilityFilter value={visibilityFilter} onChange={setVisibilityFilter} />
        </Flexbox>
      </Flexbox>
      <EnvironmentManager
        createVisibility={'private'}
        headerLeading={<SectionTitle title={t('environmentsAndCreds.section.environments')} />}
        visibilityFilter={visibilityFilter}
        onOpenEnvironment={(id) => navigate(`/settings/environments/${encodeURIComponent(id)}`)}
      />
      <WorkspaceCredsSection visibilityFilter={visibilityFilter} />
    </Flexbox>
  );
});

WorkspaceEnvironmentsSetting.displayName = 'WorkspaceEnvironmentsSetting';

export default WorkspaceEnvironmentsSetting;
