'use client';

import { Button, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import {
  matchesConnectorKeyword,
  matchesIntegrationKeyword,
} from '@/features/Settings/skill/features/connectorSections';
import { RowAddAction } from '@/features/Settings/skill/features/RowActions';
import { useToolStore } from '@/store/tool';
import { isMobileSurface } from '@/utils/mobileSurface';

import CatalogSection from '../Catalog/CatalogSection';
import DiscoverCatalogHeader from '../Catalog/DiscoverCatalogHeader';
import { catalogStyles } from '../Catalog/styles';
import { useCatalogDetailNavigate } from '../Catalog/useCatalogDetailNavigate';
import { MARKETPLACE_APPS_PATH } from '../paths';
import AppRow from './AppRow';
import AppRowMenu from './AppRowMenu';
import {
  appCategories,
  appUrl,
  CATEGORY_PREVIEW_COUNT,
  getAppHome,
  getInlineConnectTool,
  hasAppConnection,
  isAppCategory,
} from './catalog';
import OfficialMcpItem from './OfficialMcpItem';
import { useAppSummary } from './useAppSummary';
import { useMarketplaceApps } from './useMarketplaceApps';

/** `?connect=1` on an app's page starts connecting it as the page opens. */
export const CONNECT_ON_OPEN_PARAM = 'connect';

/**
 * The Apps catalog: apps grouped by category in two columns. Each group previews
 * its first rows; its arrow opens the category's own page (`?category=`), and a
 * search lists every match. A row opens the app's page; its `+` opens that page
 * and starts connecting there, so the page is already showing when the sign-in
 * lands. A connected row's `…` holds Details and Disconnect.
 */
export default function AppCatalog() {
  const { t } = useTranslation('discover');
  const { t: ts } = useTranslation('setting');
  const { t: tm } = useTranslation('messenger');
  const [params, setParams] = useSearchParams();
  const connected = params.get('view') === 'connected';
  const keyword = params.get('q') ?? '';
  const categoryParam = params.get('category');
  const category = isAppCategory(categoryParam) ? categoryParam : undefined;
  const navigate = useCatalogDetailNavigate();
  const summaryOf = useAppSummary();
  const { apps, lobehubEnabled, loading, refreshing, error, retry } = useMarketplaceApps();
  const workspace = useActiveWorkspaceId();
  const useFetchConnectors = useToolStore((s) => s.useFetchConnectors);
  const connectorsSync = useFetchConnectors(!!workspace);
  const rows = apps
    .filter((app) => !connected || hasAppConnection(app))
    .filter((app) => !category || app.category === category)
    .map((app) => ({ ...app, summary: summaryOf(app) }))
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
  const renderRows = (items: typeof rows) =>
    items.map((app) => {
      const isConnected = hasAppConnection(app);
      const home = getAppHome(app);
      const open = () => navigate(home);
      const inlineTool = getInlineConnectTool(app, lobehubEnabled);
      const label = t('catalog.rowAction', {
        action: isConnected
          ? t('apps.manage')
          : app.channelPending
            ? t('apps.continue')
            : t('apps.connect'),
        name: app.name,
      });
      if (app.officialMcp)
        return (
          <OfficialMcpItem app={app} key={app.id} server={app.officialMcp} summary={app.summary} />
        );
      return (
        <AppRow
          app={app}
          key={app.id}
          summary={app.summary}
          action={
            <>
              {app.channel?.access?.requiredPlan === 'paid' && (
                <Tag size={'small'}>{tm('messenger.paidBadge')}</Tag>
              )}
              {isConnected ? (
                <AppRowMenu app={app} label={label} onOpenDetail={open} />
              ) : (
                <RowAddAction
                  label={label}
                  onClick={() =>
                    navigate(
                      inlineTool
                        ? appUrl(home, {
                            [CONNECT_ON_OPEN_PARAM]: '1',
                          })
                        : home,
                    )
                  }
                />
              )}
            </>
          }
          onOpen={open}
        />
      );
    });

  // A category page and a search show every row; the catalog previews each category.
  const full = Boolean(category) || Boolean(keyword.trim());

  return (
    <div {...stylex.props(catalogStyles.frame)}>
      <DiscoverCatalogHeader
        kind={'app'}
        group={
          category
            ? {
                backTo: appUrl(MARKETPLACE_APPS_PATH, {
                  q: keyword || undefined,
                  view: connected ? 'connected' : undefined,
                }),
                title: t(`apps.category.${category}`),
              }
            : undefined
        }
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
        {appCategories.map((group) => {
          const items = rows.filter((app) => app.category === group);
          if (!items.length) return null;
          // The category's own page is titled by the header: just its rows.
          if (category)
            return (
              <div key={group} {...stylex.props(catalogStyles.grid)}>
                {renderRows(items)}
              </div>
            );
          const visible = full ? items : items.slice(0, CATEGORY_PREVIEW_COUNT);
          return (
            <CatalogSection
              count={items.length}
              key={group}
              label={t(`apps.category.${group}`)}
              loading={false}
              to={
                full || items.length <= CATEGORY_PREVIEW_COUNT
                  ? undefined
                  : appUrl(MARKETPLACE_APPS_PATH, {
                      category: group,
                      view: connected ? 'connected' : undefined,
                    })
              }
            >
              {renderRows(visible)}
            </CatalogSection>
          );
        })}
      </AsyncBoundary>
    </div>
  );
}
