'use client';

import { Button, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import ComposioSkillItem from '@/features/Settings/skill/features/ComposioSkillItem';
import {
  matchesConnectorKeyword,
  matchesIntegrationKeyword,
} from '@/features/Settings/skill/features/connectorSections';
import LobehubSkillItem from '@/features/Settings/skill/features/LobehubSkillItem';
import { RowAddAction, RowMoreMenu } from '@/features/Settings/skill/features/RowActions';
import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { useToolStore } from '@/store/tool';
import { isMobileSurface } from '@/utils/mobileSurface';

import CatalogSection from '../Catalog/CatalogSection';
import DiscoverCatalogHeader from '../Catalog/DiscoverCatalogHeader';
import { catalogStyles } from '../Catalog/styles';
import { useCatalogDetailNavigate } from '../Catalog/useCatalogDetailNavigate';
import { AppIcon } from './AppIcon';
import { appCategories, getAppHome, getInlineConnectTool, hasAppConnection } from './catalog';
import { useMarketplaceApps } from './useMarketplaceApps';

export default function AppCatalog() {
  const { t } = useTranslation('discover');
  const { t: ts } = useTranslation('setting');
  const { t: tm } = useTranslation('messenger');
  const [params, setParams] = useSearchParams();
  const connected = params.get('view') === 'connected';
  const keyword = params.get('q') ?? '';
  const navigate = useCatalogDetailNavigate();
  const {
    apps,
    composioServers,
    lobehubServers,
    lobehubEnabled,
    loading,
    refreshing,
    error,
    retry,
  } = useMarketplaceApps();
  const workspace = useActiveWorkspaceId();
  const useFetchConnectors = useToolStore((s) => s.useFetchConnectors);
  const connectorsSync = useFetchConnectors(!!workspace);
  const connectorsReady = useToolStore((s) => s.isConnectorsInit);
  const composioReady = useToolStore((s) => s.isComposioServersInit);
  const lobehubReady = useToolStore((s) => s.lobehubSkillServers !== undefined);
  const rows = apps
    .filter((app) => !connected || hasAppConnection(app))
    .map((app) => {
      const { channel, tool } = app;
      const summary = channel
        ? t(`apps.summary.channel.${channel.id}`, {
            defaultValue: tm(`messenger.list.${channel.id}.description`),
          })
        : t(`apps.summary.tool.${app.id}`, {
            defaultValue:
              (tool?.type === 'lobehub'
                ? tool.provider.description
                : tool?.serverType.description) ?? '',
          });
      return { ...app, summary };
    })
    .filter(
      (app) =>
        matchesConnectorKeyword(keyword, [
          app.name,
          app.id,
          app.summary,
          t(`apps.category.${app.category}`),
          app.channel && tm(`messenger.list.${app.channel.id}.description`),
        ]) ||
        (app.tool && matchesIntegrationKeyword(app.tool, keyword, ts)),
    );

  return (
    <div {...stylex.props(catalogStyles.frame)}>
      <DiscoverCatalogHeader
        kind={'app'}
        titleExtra={
          isMobileSurface() && (
            <Button
              aria-pressed={connected}
              size={'small'}
              type={connected ? 'primary' : 'default'}
              onClick={() => {
                const next = new URLSearchParams(params);
                if (connected) next.delete('view');
                else next.set('view', 'connected');
                setParams(next);
              }}
            >
              {t('apps.connected')}
            </Button>
          )
        }
      />
      {workspace && connectorsSync.error && (
        <AsyncError
          error={connectorsSync.error}
          variant={'block'}
          onRetry={() => void connectorsSync.mutate()}
        />
      )}
      {Boolean(error) && <AsyncError error={error} variant={'block'} onRetry={retry} />}
      <AsyncBoundary
        data={loading ? undefined : rows.length || undefined}
        isEmpty={!error && rows.length === 0}
        isLoading={loading || (connected && refreshing)}
        loading={<CatalogRowsSkeleton />}
        empty={
          <Text align={'center'} type={'secondary'}>
            {keyword ? t('apps.noMatches') : connected ? t('apps.noneConnected') : t('apps.empty')}
          </Text>
        }
      >
        {appCategories.map((category) => {
          const group = rows.filter((app) => app.category === category);
          if (!group.length) return null;
          return (
            <CatalogSection
              count={group.length}
              key={category}
              label={t(`apps.category.${category}`)}
              loading={false}
            >
              {group.map((app) => {
                const isConnected = hasAppConnection(app);
                const label = t('catalog.rowAction', {
                  action: isConnected
                    ? t('apps.manage')
                    : app.channelPending
                      ? t('apps.continue')
                      : t('apps.connect'),
                  name: app.name,
                });
                const open = () => navigate(getAppHome(app));
                const row = {
                  icon: () => <AppIcon app={app} size={20} />,
                  onClick: open,
                  summary: app.summary,
                  title: app.name,
                };
                const tool = getInlineConnectTool(app, lobehubEnabled);
                if (tool) {
                  const ready = tool.type === 'composio' ? composioReady : lobehubReady;
                  if (!ready || (workspace && !connectorsReady))
                    return (
                      <SkillListRow
                        {...row}
                        extra={<RowAddAction disabled label={label} onClick={open} />}
                        key={app.id}
                      />
                    );
                  return tool.type === 'composio' ? (
                    <ComposioSkillItem
                      catalogRow={row}
                      key={app.id}
                      server={composioServers.find((s) => s.identifier === app.id)}
                      serverType={tool.serverType}
                    />
                  ) : (
                    <LobehubSkillItem
                      catalogRow={row}
                      key={app.id}
                      provider={tool.provider}
                      server={lobehubServers.find((s) => s.identifier === app.id)}
                    />
                  );
                }
                return (
                  <SkillListRow
                    {...row}
                    key={app.id}
                    extra={
                      <>
                        {app.channel?.access?.requiredPlan === 'paid' && (
                          <Tag size={'small'}>{tm('messenger.paidBadge')}</Tag>
                        )}
                        {isConnected ? (
                          <RowMoreMenu label={label} onOpenDetail={open} />
                        ) : (
                          <RowAddAction label={label} onClick={open} />
                        )}
                      </>
                    }
                  />
                );
              })}
            </CatalogSection>
          );
        })}
      </AsyncBoundary>
    </div>
  );
}
