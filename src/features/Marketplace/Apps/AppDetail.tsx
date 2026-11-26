'use client';

import { Button, Flexbox, Icon, Segmented, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ExternalLink, PlusIcon } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import { MarketplaceDetailBodySkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { ConnectorDetailEmbeddedContext } from '@/features/Connectors/ConnectorDetail';
import { hasConnectorPage } from '@/features/Integrations/connectorPage';
import InstallResult from '@/features/Messenger/InstallResult';
import IntegrationDetail from '@/features/Messenger/IntegrationDetail';
import ComposioSkillItem from '@/features/Settings/skill/features/ComposioSkillItem';
import SkillDetail from '@/features/Settings/skill/features/SkillDetail';
import { useSkillConnect } from '@/features/SkillStore/SkillList/LobeHub/useSkillConnect';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { connectorSelectors, isIntegrationInConnectorTab } from '@/store/tool/slices/connector';
import { isMobileSurface } from '@/utils/mobileSurface';

import { catalogStyles } from '../Catalog/styles';
import { MARKETPLACE_APPS_PATH } from '../paths';
import { CONNECT_ON_OPEN_PARAM } from './AppCatalog';
import AppTile from './AppTile';
import BackLink from './BackLink';
import {
  getAppFacts,
  getInlineConnectTool,
  hasAppConnection,
  type MarketplaceApp,
} from './catalog';
import { CardSection } from './MarketCard';
import { useAppSummary } from './useAppSummary';
import { useMarketplaceApps } from './useMarketplaceApps';

const styles = stylex.create({
  facts: {
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr)',
    rowGap: 10,
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    color: {
      'default': cssVar.colorText,
      ':hover': cssVar.colorPrimary,
    },
  },
  status: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    gap: 6,
    paddingBlock: 2,
    paddingInline: 8,
    borderRadius: 999,
    fontSize: 12,
    lineHeight: '18px',
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
  },
});

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * "+ Connect" for an app connected as a LobeHub or Composio tool. Arriving with
 * `?connect=1` (the catalog's `+`) starts it once, then drops the flag so a
 * reload or Back does not sign in again.
 */
const ConnectButton = memo<{
  app: MarketplaceApp & { tool: NonNullable<MarketplaceApp['tool']> };
}>(({ app }) => {
  const { t } = useTranslation('discover');
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const allowed = canCreate && canEdit;
  const { handleConnect, isConnecting } = useSkillConnect({
    identifier: app.id,
    serverName: app.name,
    type: app.tool.type,
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current || params.get(CONNECT_ON_OPEN_PARAM) !== '1') return;
    started.current = true;
    const next = new URLSearchParams(params);
    next.delete(CONNECT_ON_OPEN_PARAM);
    setParams(next, { replace: true, state: location.state });
    if (allowed) void handleConnect();
    // Once per arrival; `handleConnect` changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Button
      disabled={!allowed}
      icon={<Icon icon={PlusIcon} />}
      loading={isConnecting}
      type={'fill'}
      onClick={() => void handleConnect()}
    >
      {t('apps.connect')}
    </Button>
  );
});

ConnectButton.displayName = 'MarketplaceAppConnectButton';

/** What the app is and who makes it: its guide, then developer, integrator, category, website. */
const InfoCard = memo<{ app: MarketplaceApp }>(({ app }) => {
  const { t } = useTranslation(['discover', 'setting']);
  const { integrator, vendor, vendorUrl } = getAppFacts(app);
  const { tool } = app;
  const readme =
    tool?.type === 'lobehub'
      ? t(`tools.lobehubSkill.providers.${tool.provider.id}.readme`, {
          defaultValue: tool.provider.readme,
          ns: 'setting',
        })
      : tool
        ? t(`tools.composio.servers.${tool.serverType.identifier}.readme`, {
            defaultValue: tool.serverType.readme,
            ns: 'setting',
          })
        : undefined;

  return (
    <CardSection title={t('apps.detail.info')}>
      {readme && <Text style={{ lineHeight: 1.7 }}>{readme}</Text>}
      <div {...stylex.props(styles.facts)}>
        <Text type={'secondary'}>{t('apps.detail.developer')}</Text>
        <Text>{vendor}</Text>
        {integrator && (
          <>
            <Text type={'secondary'}>{t('apps.detail.integrator')}</Text>
            <Text>{integrator}</Text>
          </>
        )}
        <Text type={'secondary'}>{t('apps.detail.category')}</Text>
        <Text>{t(`apps.category.${app.category}`)}</Text>
        {vendorUrl && (
          <>
            <Text type={'secondary'}>{t('apps.detail.website')}</Text>
            <a href={vendorUrl} rel={'noreferrer'} target={'_blank'} {...stylex.props(styles.link)}>
              {hostOf(vendorUrl)}
              <Icon icon={ExternalLink} size={14} />
            </a>
          </>
        )}
      </div>
    </CardSection>
  );
});

InfoCard.displayName = 'MarketplaceAppInfoCard';

/**
 * An app's own page: a back link, then the header — its tile, name, a
 * Connected pill once connected, what it does, and "+ Connect" while it is not.
 * Below it, an app that is both a chat channel and a tool switches between the
 * two. A connected tool (and GitHub / Linear, which manage an integration)
 * shows its connector page in cards; otherwise an Information card says what
 * the app is and who makes it.
 */
export default function AppDetail() {
  const { appId } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation(['discover', 'setting']);
  const summaryOf = useAppSummary();
  const { apps, composioServers, lobehubEnabled, loading, error, retry } = useMarketplaceApps();
  const app = apps.find((entry) => entry.id === appId);
  const tool = app?.tool;
  const channel = app?.channel;
  const workspace = useActiveWorkspaceId();
  const useConnectors = useToolStore((s) => s.useFetchConnectors);
  useConnectors(!!tool);
  const connectors = useToolStore(connectorSelectors.connectorList, isEqual);
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

  const connectorPage = !!app && (hasConnectorPage(app.id) || app.toolConnected);
  const inlineTool = app && getInlineConnectTool(app, lobehubEnabled);

  return (
    <div
      {...stylex.props(
        catalogStyles.frame,
        isMobileSurface() ? catalogStyles.pageTopMobile : catalogStyles.pageTop,
      )}
    >
      {(appId === 'slack' || appId === 'discord') && <InstallResult key={appId} platform={appId} />}
      <Flexbox gap={12}>
        <BackLink onClick={onBack} />
        <AsyncBoundary
          data={app}
          empty={<Text type={'secondary'}>{t('apps.unavailable')}</Text>}
          error={error}
          isEmpty={!app}
          isLoading={loading}
          loading={<MarketplaceDetailBodySkeleton />}
          onRetry={retry}
        >
          {app && (
            <Flexbox gap={24}>
              <Flexbox horizontal align={'center'} gap={16}>
                <AppTile app={app} size={56} />
                <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Text as={'h1'} fontSize={18} style={{ margin: 0 }} weight={600}>
                      {app.name}
                    </Text>
                    {hasAppConnection(app) && (
                      <span {...stylex.props(styles.status)}>{t('apps.detail.connected')}</span>
                    )}
                  </Flexbox>
                  <Text ellipsis type={'secondary'}>
                    {summaryOf(app)}
                  </Text>
                </Flexbox>
                {inlineTool && <ConnectButton app={{ ...app, tool: inlineTool }} />}
              </Flexbox>
              {channel && tool && (
                <Segmented<'channel' | 'tools'>
                  style={{ alignSelf: 'flex-start' }}
                  value={selected}
                  options={[
                    { label: t('apps.chatCapability'), value: 'channel' },
                    { label: t('apps.toolCapability'), value: 'tools' },
                  ]}
                  onChange={(next) => updateParam('capability', next)}
                />
              )}
              {selected === 'channel' && channel && (
                <>
                  <IntegrationDetail
                    access={channel.access}
                    appId={channel.appId}
                    botUsername={channel.botUsername}
                    name={app.name}
                    platform={channel.id}
                  />
                  {!tool && <InfoCard app={app} />}
                </>
              )}
              {selected === 'tools' && tool && (
                <>
                  {workspace && inPublic && inPrivate && (
                    <Segmented<'public' | 'private'>
                      style={{ alignSelf: 'flex-start' }}
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
                  {connectorPage ? (
                    <>
                      {/* Its status row carries Reauthorize when Composio asks again. */}
                      {tool.type === 'composio' && (
                        <ComposioSkillItem server={composioServer} serverType={tool.serverType} />
                      )}
                      <ConnectorDetailEmbeddedContext value>
                        <SkillDetail
                          identifier={app.id}
                          type={tool.type === 'lobehub' ? 'lobehub-connector' : 'plugin'}
                          visibility={visibility}
                        />
                      </ConnectorDetailEmbeddedContext>
                    </>
                  ) : (
                    <InfoCard app={app} />
                  )}
                </>
              )}
            </Flexbox>
          )}
        </AsyncBoundary>
      </Flexbox>
    </div>
  );
}
