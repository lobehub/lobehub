'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '../../../../types/botRuntimeStatus';
import { type ChannelPlatformDefinition, COMING_SOON_PLATFORMS } from './const';
import PlatformDetail from './detail';
import ComingSoonDetail from './detail/ComingSoon';
import PlatformList from './list';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    display: flex;
    flex: 1;

    width: 100%;
    height: 100%;
  `,
}));

const ChannelPage = memo(() => {
  const { aid } = useParams<{ aid?: string }>();
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const { data: platforms, isLoading: platformsLoading } = useAgentStore((s) =>
    s.useFetchPlatformDefinitions(),
  );
  const { data: providers, isLoading: providersLoading } = useAgentStore((s) =>
    s.useFetchBotProviders(aid),
  );
  const triggerRefreshAllBotStatuses = useAgentStore((s) => s.triggerRefreshAllBotStatuses);
  const enableImessage = useUserStore(labPreferSelectors.enableImessage);

  // Fire-and-forget a live gateway status refresh on entry. The list renders
  // from cached statuses immediately; SWR revalidates once Redis is updated.
  useEffect(() => {
    if (!aid) return;
    if (!canEdit) return;
    triggerRefreshAllBotStatuses(aid);
  }, [aid, canEdit, triggerRefreshAllBotStatuses]);

  const isLoading = platformsLoading || providersLoading;

  // Merge server-side platforms with frontend-only coming-soon entries.
  // Coming-soon entries shadow a server-registered platform of the same id, so a
  // platform can be registered server-side first and stay a placeholder until
  // the frontend reveals it. iMessage additionally honors the Labs
  // `enableImessage` preference: off keeps the placeholder, on drops it so the
  // real platform shows.
  const allPlatforms = useMemo<ChannelPlatformDefinition[]>(() => {
    const comingSoon = enableImessage
      ? COMING_SOON_PLATFORMS.filter((p) => p.id !== 'imessage')
      : COMING_SOON_PLATFORMS;
    const comingSoonIds = new Set(comingSoon.map((p) => p.id));
    return [...(platforms ?? []).filter((p) => !comingSoonIds.has(p.id)), ...comingSoon];
  }, [platforms, enableImessage]);

  // Default to first platform once loaded
  const effectiveActiveId = activeProviderId || allPlatforms[0]?.id || '';

  const platformRuntimeStatuses = useMemo(
    () =>
      new Map<string, BotRuntimeStatus>(
        (providers ?? [])
          .filter((provider) => provider.enabled)
          .map((provider) => [
            provider.platform,
            ((provider as any).runtimeStatus as BotRuntimeStatus) ??
              BOT_RUNTIME_STATUSES.disconnected,
          ]),
      ),
    [providers],
  );

  const activePlatformDef = useMemo(
    () => allPlatforms.find((p) => p.id === effectiveActiveId) || allPlatforms[0],
    [allPlatforms, effectiveActiveId],
  );

  const currentConfig = useMemo(
    () => providers?.find((p) => p.platform === effectiveActiveId),
    [providers, effectiveActiveId],
  );

  if (!aid) return null;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader />
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        {isLoading && <Loading debugId="ChannelPage" />}

        {!isLoading && allPlatforms.length > 0 && activePlatformDef && (
          <div className={styles.container}>
            <PlatformList
              activeId={effectiveActiveId}
              agentId={aid}
              disabled={!canEdit}
              platforms={allPlatforms}
              providers={providers}
              runtimeStatuses={platformRuntimeStatuses}
              onSelect={setActiveProviderId}
            />
            {activePlatformDef.comingSoon ? (
              <ComingSoonDetail platformDef={activePlatformDef} />
            ) : (
              <PlatformDetail
                agentId={aid}
                currentConfig={currentConfig}
                disabled={!canEdit}
                platformDef={activePlatformDef}
                runtimeStatus={platformRuntimeStatuses.get(activePlatformDef.id)}
              />
            )}
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default ChannelPage;
