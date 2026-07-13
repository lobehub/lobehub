'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import NotFound from '@/components/404';
import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '../../../../types/botRuntimeStatus';
import { type ChannelPlatformDefinition, COMING_SOON_PLATFORMS } from './const';
import PlatformDetail from './detail';
import ComingSoonDetail from './detail/ComingSoon';
import Header from './Header';
import PlatformGrid from './list';

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

const ChannelPage = memo(() => {
  const { aid, platform } = useParams<{ aid?: string; platform?: string }>();
  const navigate = useNavigate();
  const { allowed: canEdit } = usePermission('edit_own_content');

  const {
    data: platforms,
    isLoading: platformsLoading,
    error: platformsError,
    mutate: mutatePlatforms,
  } = useAgentStore((s) => s.useFetchPlatformDefinitions());
  const {
    data: providers,
    isLoading: providersLoading,
    error: providersError,
    mutate: mutateProviders,
  } = useAgentStore((s) => s.useFetchBotProviders(aid));
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
  const error = platformsError ?? providersError;

  // Both fetches carry `fallbackData: []`, so a *failed* fetch leaves
  // `platforms = []` and `allPlatforms` collapses to just the frontend-only
  // `COMING_SOON_PLATFORMS` — `length > 0` stays true and the surface would
  // render a plausible coming-soon-only catalog (every real / connected channel
  // silently dropped). So "has data" is *not* the merged length: it's whether the
  // real fetch actually yielded platforms. Gate on the raw fetched `platforms`
  // (never the static merge) and require the providers fetch to have not errored,
  // so a failed load branches to an error state before we merge the static half.
  const hasData = (platforms?.length ?? 0) > 0 && !providersError;

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
        providers={providers}
        runtimeStatus={
          activePlatformDef ? platformRuntimeStatuses.get(activePlatformDef.id) : undefined
        }
      />
      <Flexbox flex={1} style={{ overflow: 'hidden' }}>
        <AsyncBoundary
          data={hasData ? platforms : undefined}
          error={error}
          errorVariant={'block'}
          isLoading={isLoading}
          loading={<Loading debugId="ChannelPage" />}
          onRetry={() => {
            mutatePlatforms();
            mutateProviders();
          }}
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

export default ChannelPage;
