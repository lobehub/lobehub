'use client';

import { Button, Flexbox, Segmented, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { hasConnectorPage } from '@/features/Integrations/connectorPage';
import InstallResult from '@/features/Messenger/InstallResult';
import IntegrationDetail from '@/features/Messenger/IntegrationDetail';
import ComposioSkillItem from '@/features/Settings/skill/features/ComposioSkillItem';
import LobehubSkillItem from '@/features/Settings/skill/features/LobehubSkillItem';
import SkillDetail from '@/features/Settings/skill/features/SkillDetail';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useToolStore } from '@/store/tool';
import { connectorSelectors, isIntegrationInConnectorTab } from '@/store/tool/slices/connector';

import { catalogStyles } from '../Catalog/styles';
import { MARKETPLACE_APPS_PATH } from '../paths';
import { useMarketplaceApps } from './useMarketplaceApps';

export default function AppDetail() {
  const { appId } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation(['discover', 'setting']);
  const { apps, composioServers, lobehubServers, toolSync, loading, error, retry } =
    useMarketplaceApps();
  const app = apps.find((entry) => entry.id === appId);
  const tool = app?.tool;
  const channel = app?.channel;
  const workspace = useActiveWorkspaceId();
  const useConnectors = useToolStore((s) => s.useFetchConnectors);
  const connectorsSync = useConnectors(!!tool);
  const connectors = useToolStore(connectorSelectors.connectorList, isEqual);
  const initialized = useToolStore((s) => s.isConnectorsInit);
  const toolInitialized = useToolStore((s) =>
    tool?.type === 'composio' ? s.isComposioServersInit : s.lobehubSkillServers !== undefined,
  );
  const composioServer = composioServers.find((s) => s.identifier === appId);
  const account = tool?.type === 'composio' ? composioServer?.connectedAccountId : undefined;
  const inPublic = app && isIntegrationInConnectorTab(app.id, connectors, 'public', account);
  const inPrivate = app && isIntegrationInConnectorTab(app.id, connectors, 'private', account);
  const privateTab = inPrivate && (!inPublic || params.get('visibility') === 'private');
  const visibility = workspace ? (privateTab ? 'private' : 'public') : undefined;
  const selected = channel && (!tool || params.get('capability') !== 'tools') ? 'channel' : 'tools';
  const updateParam = (key: string, value: string) => {
    const query = new URLSearchParams(params);
    query.set(key, value);
    setParams(query, { replace: true, state: location.state });
  };

  const onBack = () => {
    if (location.state?.marketplaceCatalog) navigate(-1);
    else navigate(MARKETPLACE_APPS_PATH);
  };
  return (
    <div {...stylex.props(catalogStyles.frame)}>
      {(appId === 'slack' || appId === 'discord') && <InstallResult key={appId} platform={appId} />}
      <Flexbox align={'flex-start'}>
        <Button icon={ChevronLeft} size={'small'} type={'text'} onClick={onBack}>
          {t('tab.apps')}
        </Button>
      </Flexbox>
      <AsyncBoundary
        data={app}
        empty={<Text type={'secondary'}>{t('apps.unavailable')}</Text>}
        error={error}
        isEmpty={!app}
        isLoading={loading}
        loading={<CatalogRowsSkeleton />}
        onRetry={retry}
      >
        {app && (
          <>
            {channel && tool && (
              <Segmented<'channel' | 'tools'>
                value={selected}
                options={[
                  { label: t('apps.chatCapability'), value: 'channel' },
                  { label: t('apps.toolCapability'), value: 'tools' },
                ]}
                onChange={(next) => updateParam('capability', next)}
              />
            )}
            {selected === 'channel' && channel && (
              <IntegrationDetail
                access={channel.access}
                appId={channel.appId}
                botUsername={channel.botUsername}
                name={app.name}
                platform={channel.id}
              />
            )}
            {selected === 'tools' && tool && (
              <>
                {workspace && inPublic && inPrivate && (
                  <Segmented<'public' | 'private'>
                    value={visibility}
                    options={[
                      {
                        value: 'public',
                        label: t('skillView.connectorTabs.workspace', { ns: 'setting' }),
                      },
                      {
                        value: 'private',
                        label: t('skillView.connectorTabs.private', { ns: 'setting' }),
                      },
                    ]}
                    onChange={(next) => updateParam('visibility', next)}
                  />
                )}
                {hasConnectorPage(app.id) || app.toolConnected ? (
                  <>
                    {tool.type === 'composio' && (
                      <ComposioSkillItem server={composioServer} serverType={tool.serverType} />
                    )}
                    <SkillDetail
                      identifier={app.id}
                      type={tool.type === 'lobehub' ? 'lobehub-connector' : 'plugin'}
                      visibility={visibility}
                    />
                  </>
                ) : (
                  <AsyncBoundary
                    data={(toolInitialized && (!workspace || initialized)) || undefined}
                    error={toolSync[tool.type].error ?? connectorsSync.error}
                    loading={<CatalogRowsSkeleton count={1} />}
                    isLoading={
                      toolSync[tool.type].isValidating || (!initialized && connectorsSync.isLoading)
                    }
                    onRetry={() => {
                      retry();
                      void connectorsSync.mutate();
                    }}
                  >
                    {tool.type === 'lobehub' ? (
                      <LobehubSkillItem
                        provider={tool.provider}
                        server={lobehubServers.find((s) => s.identifier === app.id)}
                      />
                    ) : (
                      <ComposioSkillItem server={composioServer} serverType={tool.serverType} />
                    )}
                    <Text as={'p'}>
                      {tool.type === 'lobehub'
                        ? t(`tools.lobehubSkill.providers.${tool.provider.id}.readme`, {
                            ns: 'setting',
                            defaultValue: tool.provider.readme,
                          })
                        : t(`tools.composio.servers.${tool.serverType.identifier}.readme`, {
                            ns: 'setting',
                            defaultValue: tool.serverType.readme,
                          })}
                    </Text>
                  </AsyncBoundary>
                )}
              </>
            )}
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
