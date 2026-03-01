'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import { useAgentStore } from '@/store/agent';

import { INTEGRATION_PROVIDERS } from './const';
import PlatformDetail from './PlatformDetail';
import PlatformList from './PlatformList';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    display: flex;
    flex: 1;

    width: 100%;
    height: 100%;
  `,
}));

const IntegrationPage = memo(() => {
  const { aid } = useParams<{ aid?: string }>();
  const [activeProviderId, setActiveProviderId] = useState(INTEGRATION_PROVIDERS[0].id);

  const { data: providers, isLoading } = useAgentStore((s) => s.useFetchBotProviders(aid));

  const connectedPlatforms = useMemo(
    () => new Set(providers?.map((p) => p.platform) ?? []),
    [providers],
  );

  const activeProvider = useMemo(
    () => INTEGRATION_PROVIDERS.find((p) => p.id === activeProviderId) || INTEGRATION_PROVIDERS[0],
    [activeProviderId],
  );

  const currentConfig = useMemo(
    () => providers?.find((p) => p.platform === activeProviderId),
    [providers, activeProviderId],
  );

  if (!aid) return null;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader />
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        {isLoading && <Loading debugId="IntegrationPage" />}

        {!isLoading && (
          <div className={styles.container}>
            <PlatformList
              activeId={activeProviderId}
              connectedPlatforms={connectedPlatforms}
              providers={INTEGRATION_PROVIDERS}
              onSelect={setActiveProviderId}
            />
            <PlatformDetail agentId={aid} currentConfig={currentConfig} provider={activeProvider} />
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default IntegrationPage;
