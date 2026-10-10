import { Flexbox } from '@lobehub/ui';
import { Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowUpRightIcon, LayoutDashboardIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import { WidgetDetailPanel } from '@/features/Dashboard/WidgetDetail';
import WidgetRunPreview from '@/features/Dashboard/WidgetDetail/RunPreview';
import { canCreateDashboardFromPreview } from '@/features/Dashboard/WidgetPreview/previewWidget';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useServerConfigStore } from '@/store/serverConfig';

import { useOpenDashboard } from './useOpenDashboard';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
  preview: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));

const Section = memo<{ children: ReactNode; extra?: ReactNode; title: string }>(
  ({ children, extra, title }) => (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <span className={styles.label}>{title}</span>
        {extra}
      </Flexbox>
      {children}
    </Flexbox>
  ),
);

Section.displayName = 'DashboardWidgetPortalSection';

/** The dry run the conversation opened this view from, rendered in full. */
const RunPreviewSection = memo<{ runId: string; widgetId: string }>(({ runId, widgetId }) => {
  const { t } = useTranslation('dashboard');
  const useFetchWidgetRun = useDashboardStore((s) => s.useFetchWidgetRun);
  const { error, mutate } = useFetchWidgetRun(widgetId, runId);
  const run = useDashboardStore(dashboardSelectors.widgetRunDetail(runId));
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widgetId));
  const view = versions.find((version) => version.id === run?.versionId)?.view;

  return (
    <Section title={t('portal.preview')}>
      <Text fontSize={12} type={'secondary'}>
        {t('portal.previewHint')}
      </Text>
      <div className={styles.preview}>
        {error ? (
          <AsyncError error={error} onRetry={() => void mutate()} />
        ) : run ? (
          <WidgetRunPreview run={run} view={view} />
        ) : (
          <Skeleton height={160} width={'100%'} />
        )}
      </div>
    </Section>
  );
});

RunPreviewSection.displayName = 'DashboardWidgetPortalRunPreview';

/**
 * A dashboard widget beside the conversation that built it: what it measures,
 * the dry run the conversation produced, where it lives, and the full
 * drill-down (live data, run logs, versions and their diff).
 */
const Body = memo(() => {
  const { t } = useTranslation('dashboard');
  const view = useChatStore(chatPortalSelectors.dashboardWidgetView);
  const widgetId = view?.widgetId;
  const useFetchWidgetDetail = useDashboardStore((s) => s.useFetchWidgetDetail);
  const { error, mutate } = useFetchWidgetDetail(widgetId);
  const widget = useDashboardStore(dashboardSelectors.widgetDetail(widgetId));
  const openDashboard = useOpenDashboard();
  // A workspace-root widget's board list resolves to the home list, which
  // workspaces disable — opening it would close this Portal onto nothing.
  // And dashboard routes exist only in the desktop shell, so on mobile every
  // dashboard navigation hides rather than clear the stack onto nothing.
  const isMobile = useServerConfigStore((s) => s.isMobile);
  const workspaceActive = !!useActiveWorkspaceSlug();
  const canOpenDashboards =
    !isMobile && canCreateDashboardFromPreview(widget?.projectId, workspaceActive);

  if (!widgetId) return null;

  if (error && !widget) {
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflowY: 'auto' }}>
        <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />
      </Flexbox>
    );
  }

  if (!widget) {
    return (
      <Flexbox gap={12} padding={16}>
        <Skeleton height={80} width={'100%'} />
        <Skeleton height={200} width={'100%'} />
      </Flexbox>
    );
  }

  // Normalize once: an older server may not send the widget's boards list.
  const dashboards = widget.dashboards ?? [];

  return (
    <Flexbox
      data-portal-widget={widget.id}
      flex={1}
      gap={20}
      height={'100%'}
      padding={16}
      style={{ minHeight: 0, overflowY: 'auto' }}
    >
      <Section title={t('portal.definition')}>
        <Text fontSize={13}>{widget.description || t('chat.noDefinition')}</Text>
      </Section>

      {view?.runId && <RunPreviewSection runId={view.runId} widgetId={widget.id} />}

      <Section
        title={t('portal.dashboards')}
        extra={
          canOpenDashboards ? (
            <Button
              data-portal-all-dashboards
              icon={LayoutDashboardIcon}
              size={'small'}
              type={'text'}
              onClick={() => openDashboard(undefined, widget.projectId)}
            >
              {t('portal.goToDashboards')}
            </Button>
          ) : undefined
        }
      >
        {!isMobile &&
          (dashboards.length > 0 ? (
            <Flexbox horizontal gap={8} wrap={'wrap'}>
              {dashboards.map((dashboard) => (
                <Button
                  data-portal-dashboard-link={dashboard.id}
                  icon={ArrowUpRightIcon}
                  key={dashboard.id}
                  size={'small'}
                  onClick={() => openDashboard(dashboard)}
                >
                  {dashboard.title}
                </Button>
              ))}
            </Flexbox>
          ) : (
            <Text fontSize={12} type={'secondary'}>
              {t('portal.notOnDashboard')}
            </Text>
          ))}
      </Section>

      <WidgetDetailPanel diffTargetVersionId={widget.draftVersionId ?? undefined} widget={widget} />
    </Flexbox>
  );
});

Body.displayName = 'DashboardWidgetPortalBody';

export default Body;
