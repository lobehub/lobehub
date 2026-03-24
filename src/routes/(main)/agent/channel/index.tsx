'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import { useAgentStore } from '@/store/agent';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '../../../../types/botRuntimeStatus';
import PlatformDetail from './detail';
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

  const { data: platforms, isLoading: platformsLoading } = useAgentStore((s) =>
    s.useFetchPlatformDefinitions(),
  );
  const { data: providers, isLoading: providersLoading } = useAgentStore((s) =>
    s.useFetchBotProviders(aid),
  );
  const { data: runtimeStatuses } = useAgentStore((s) => s.useFetchBotRuntimeStatuses(aid));

  const isLoading = platformsLoading || providersLoading;

  // Default to first platform once loaded
  const effectiveActiveId = activeProviderId || platforms?.[0]?.id || '';

  const platformRuntimeStatuses = useMemo(
    () =>
      new Map<string, BotRuntimeStatus>(
        (providers ?? [])
          .filter((provider) => provider.enabled)
          .map((provider) => {
            const runtimeStatus = runtimeStatuses?.find(
              (item) =>
                item.platform === provider.platform &&
                item.applicationId === provider.applicationId,
            );

            return [provider.platform, runtimeStatus?.status ?? BOT_RUNTIME_STATUSES.disconnected];
          }),
      ),
    [providers, runtimeStatuses],
  );

  const activePlatformDef = useMemo(
    () => platforms?.find((p) => p.id === effectiveActiveId) || platforms?.[0],
    [platforms, effectiveActiveId],
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

        {!isLoading && platforms && platforms.length > 0 && activePlatformDef && (
          <div className={styles.container}>
            <PlatformList
              activeId={effectiveActiveId}
              platforms={platforms}
              runtimeStatuses={platformRuntimeStatuses}
              onSelect={setActiveProviderId}
            />
            <PlatformDetail
              agentId={aid}
              currentConfig={currentConfig}
              platformDef={activePlatformDef}
            />
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default ChannelPage;
