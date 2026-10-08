'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Skeleton, Tag, Text, toast, Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowUpRightIcon, PanelRightOpenIcon, RocketIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { DashboardWidgetDetail, DashboardWidgetRunItem } from '@/services/dashboard';
import { useChatStore } from '@/store/chat';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { formatDuration } from '../utils/format';
import { getDashboardPath } from '../utils/path';
import WidgetCard from '../WidgetCard';
import AddToDashboardButton from './AddToDashboardButton';
import { canPreviewPublish, getPreviewPublishState, toPreviewWidget } from './previewWidget';
import { openPublishConfirmModal } from './PublishConfirmModal';

const styles = createStaticStyles(({ css }) => ({
  definition: css`
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  root: css`
    width: 100%;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));

/** Card height by output shape — a single number needs far less room than rows. */
const CARD_HEIGHT: Record<string, number> = { list: 260, series: 240, stat: 150, table: 260 };

type PreviewRun = Pick<
  DashboardWidgetRunItem,
  'durationMs' | 'error' | 'finishedAt' | 'id' | 'output' | 'startedAt' | 'status' | 'versionId'
>;

interface WidgetPreviewBodyProps {
  run: PreviewRun;
  widget: DashboardWidgetDetail;
}

/**
 * A dry run as the user will see it on a board, with what the number means
 * and the decisions that follow: publish it, place it, or open the details.
 */
export const WidgetPreviewBody = memo<WidgetPreviewBodyProps>(({ widget, run }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useWorkspaceAwareNavigate();
  const openDashboardWidget = useChatStore((s) => s.openDashboardWidget);
  const publishWidgetVersion = useDashboardStore((s) => s.publishWidgetVersion);
  const publishing = useDashboardStore(dashboardSelectors.isWidgetPublishing(widget.id));
  const useFetchWidgetVersions = useDashboardStore((s) => s.useFetchWidgetVersions);
  useFetchWidgetVersions(widget.id);
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widget.id));

  const version = versions.find((item) => item.id === run.versionId);
  const draft = versions.find((item) => item.id === widget.draftVersionId);
  const publishState = getPreviewPublishState(widget, run);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  // Publishing is creator-only server-side; teammates reading the widget get
  // no publish action at all instead of a button that always fails.
  const canPublish = canPreviewPublish(widget, currentUserId);
  const preview = toPreviewWidget(widget, run);
  const outputType = run.output?.type ?? version?.outputType ?? 'stat';
  // Normalize once: an older server may not send the widget's boards list.
  const dashboards = widget.dashboards ?? [];

  // Publishing goes through the same review the requestPublish intervention
  // renders — nothing goes live on a bare click from the preview.
  const handlePublish = () =>
    openPublishConfirmModal({
      versionId: run.versionId,
      widgetId: widget.id,
      onConfirm: async () => {
        try {
          const result = await publishWidgetVersion(widget.id, run.versionId);
          toast.success(t('chat.published', { version: result?.version.version }));
        } catch (error) {
          toast.error(
            t('chat.publishFailed', { message: error instanceof Error ? error.message : '' }),
          );
        }
      },
    });

  return (
    <Flexbox className={styles.root} data-widget-preview={widget.id} gap={10}>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        {version && (
          <Tag color={publishState === 'live' ? 'success' : 'info'} size={'small'}>
            {t(publishState === 'live' ? 'chat.preview.live' : 'chat.preview.draft', {
              version: version.version,
            })}
          </Tag>
        )}
        <Text fontSize={12} type={'secondary'}>
          {[t(`run.status.${run.status}`), formatDuration(run.durationMs)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Flexbox flex={1} />
        <Button
          data-widget-open-portal
          icon={PanelRightOpenIcon}
          size={'small'}
          type={'text'}
          onClick={() => openDashboardWidget(widget.id, run.id)}
        >
          {t('chat.openDetail')}
        </Button>
      </Flexbox>

      <div style={{ height: CARD_HEIGHT[outputType] ?? 200 }}>
        <WidgetCard view={version?.view} widget={preview} />
      </div>

      <Flexbox className={styles.definition} gap={2}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('chat.definition')}
        </Text>
        <Text data-widget-definition fontSize={12}>
          {widget.description || t('chat.noDefinition')}
        </Text>
      </Flexbox>

      {publishState === 'outdated' && (
        <Text fontSize={12} type={'warning'}>
          {draft ? t('chat.outdated', { version: draft.version }) : t('chat.outdatedVersion')}
        </Text>
      )}

      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        {canPublish && publishState === 'publishable' && (
          <Button
            data-widget-publish
            icon={RocketIcon}
            loading={publishing}
            size={'small'}
            type={'primary'}
            onClick={handlePublish}
          >
            {t('chat.publish')}
          </Button>
        )}
        {canPublish && publishState === 'notReady' && (
          <Tooltip title={t('chat.publishHint')}>
            <Button disabled icon={RocketIcon} size={'small'}>
              {t('chat.publish')}
            </Button>
          </Tooltip>
        )}
        <AddToDashboardButton
          placedIds={dashboards.map((dashboard) => dashboard.id)}
          projectId={widget.projectId}
          widgetId={widget.id}
        />
        {dashboards.map((dashboard) => (
          <Button
            data-widget-dashboard-link={dashboard.id}
            icon={ArrowUpRightIcon}
            key={dashboard.id}
            size={'small'}
            type={'text'}
            onClick={() => navigate(getDashboardPath(dashboard))}
          >
            {t('chat.onDashboard', { title: dashboard.title })}
          </Button>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

WidgetPreviewBody.displayName = 'DashboardWidgetPreviewBody';

interface WidgetPreviewCardProps {
  /** The dry run to show. */
  runId: string;
  widgetId: string;
}

/** Loads a widget and one of its dry runs, then renders the preview. */
const WidgetPreviewCard = memo<WidgetPreviewCardProps>(({ widgetId, runId }) => {
  const { t } = useTranslation('dashboard');
  const useFetchWidgetDetail = useDashboardStore((s) => s.useFetchWidgetDetail);
  const useFetchWidgetRun = useDashboardStore((s) => s.useFetchWidgetRun);
  const widgetRequest = useFetchWidgetDetail(widgetId);
  const runRequest = useFetchWidgetRun(widgetId, runId);
  const widget = useDashboardStore(dashboardSelectors.widgetDetail(widgetId));
  const run = useDashboardStore(dashboardSelectors.widgetRunDetail(runId));

  if (widgetRequest.error || runRequest.error) {
    return (
      <Flexbox horizontal align={'center'} className={styles.root} gap={6}>
        <Icon color={cssVar.colorTextTertiary} icon={RocketIcon} size={14} />
        <Text fontSize={12} type={'secondary'}>
          {t('chat.unavailable')}
        </Text>
      </Flexbox>
    );
  }
  if (!widget || !run) {
    return (
      <Flexbox className={styles.root} gap={10}>
        <Skeleton height={150} width={'100%'} />
        <Skeleton.Text rows={2} />
      </Flexbox>
    );
  }

  return <WidgetPreviewBody run={run} widget={widget} />;
});

WidgetPreviewCard.displayName = 'DashboardWidgetPreviewCard';

/**
 * A version's successful dry run — e.g. the one a publish approval was based
 * on. Fetched by version, not from the newest-run window, so the card keeps
 * its body after the widget's run history rolls past the approval.
 */
export const WidgetVersionPreviewCard = memo<{ versionId: string; widgetId: string }>(
  ({ widgetId, versionId }) => {
    const useFetchWidgetDetail = useDashboardStore((s) => s.useFetchWidgetDetail);
    const useFetchWidgetVersionPreviewRun = useDashboardStore(
      (s) => s.useFetchWidgetVersionPreviewRun,
    );
    useFetchWidgetDetail(widgetId);
    const { data: run } = useFetchWidgetVersionPreviewRun(widgetId, versionId);
    const widget = useDashboardStore(dashboardSelectors.widgetDetail(widgetId));

    if (!widget || !run) return null;
    return <WidgetPreviewBody run={run} widget={widget} />;
  },
);

WidgetVersionPreviewCard.displayName = 'DashboardWidgetVersionPreviewCard';

export default WidgetPreviewCard;
