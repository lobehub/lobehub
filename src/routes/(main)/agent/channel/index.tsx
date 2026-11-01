'use client';

import { createStaticStyles, Flexbox } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import NotFound from '@/components/404';
import AsyncBoundary from '@/components/AsyncBoundary';
import {
  AgentChannelDetailBodySkeleton,
  AgentChannelListBodySkeleton,
} from '@/components/Skeleton/AgentChannel';
import PlatformDetail from '@/features/AgentChannel/PlatformDetail';
import ComingSoonDetail from '@/features/AgentChannel/PlatformDetail/ComingSoon';
import PlatformGrid from '@/features/AgentChannel/PlatformGrid';
import { useAgentChannels } from '@/features/AgentChannel/useAgentChannels';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import { usePermission } from '@/hooks/usePermission';

import Header from './Header';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;

    width: 100%;
    height: 100%;
  `,
}));

const ChannelContent = memo(() => {
  const { aid, platform } = useParams<{ aid?: string; platform?: string }>();
  const navigate = useNavigate();
  const { allowed: canEdit } = usePermission('edit_own_content');

  const {
    allPlatforms,
    error,
    hasData,
    isLoading,
    platformRuntimeStatuses,
    platforms,
    platformsLoading,
    providers,
    retry,
  } = useAgentChannels(aid, canEdit);

  const activePlatformDef = useMemo(
    () => (platform ? allPlatforms.find((item) => item.id === platform) : undefined),
    [allPlatforms, platform],
  );

  const currentConfig = useMemo(
    () => providers?.find((item) => item.platform === platform),
    [platform, providers],
  );

  const handleSelectPlatform = useCallback(
    (platformId: string) => navigate(platformId, { relative: 'path' }),
    [navigate],
  );

  if (!aid) return null;

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Header
        agentId={aid}
        currentConfig={currentConfig}
        disabled={!canEdit}
        platformDef={activePlatformDef}
        platformId={platform}
        platformsLoading={platformsLoading}
        providers={providers}
      />
      <Flexbox flex={1} style={{ overflow: 'hidden' }}>
        <AsyncBoundary
          data={hasData ? platforms : undefined}
          error={error}
          errorVariant={'block'}
          isLoading={isLoading}
          // Body half of the route skeleton (the real header is already mounted),
          // so the chunk wait and the platform fetch share one shape.
          loading={platform ? <AgentChannelDetailBodySkeleton /> : <AgentChannelListBodySkeleton />}
          onRetry={retry}
        >
          {!platform ? (
            <div className={styles.container}>
              <PlatformGrid
                agentId={aid}
                platforms={allPlatforms}
                runtimeStatuses={platformRuntimeStatuses}
                onSelect={handleSelectPlatform}
              />
            </div>
          ) : activePlatformDef ? (
            <div className={styles.container}>
              {activePlatformDef.comingSoon ? (
                <ComingSoonDetail platformDef={activePlatformDef} />
              ) : (
                <PlatformDetail
                  agentId={aid}
                  currentConfig={currentConfig}
                  disabled={!canEdit}
                  platformDef={activePlatformDef}
                />
              )}
            </div>
          ) : (
            <NotFound />
          )}
        </AsyncBoundary>
      </Flexbox>
    </Flexbox>
  );
});

const ChannelPage = () => {
  const { aid } = useParams<{ aid?: string }>();

  return (
    <ResourceConfigAccessGate
      redirectPath={`/agent/${aid ?? ''}`}
      resourceId={aid}
      resourceType="agent"
    >
      <ChannelContent />
    </ResourceConfigAccessGate>
  );
};

export default ChannelPage;
