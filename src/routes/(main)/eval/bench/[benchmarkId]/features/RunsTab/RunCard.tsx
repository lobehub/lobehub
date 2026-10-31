import type { AgentEvalRunListItem } from '@lobechat/types';
import { type DropdownItem, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Ellipsis,
  Pencil,
  Play,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';
import { sx } from '@/styles/sx';

import SegmentBar from '../../../../features/SegmentBar';
import StatusBadge from '../../../../features/StatusBadge';
import { formatDuration } from '../../../../utils';

const styles = stylex.create({
  arrowIcon: {
    flexShrink: 0,
    color: {
      default: cssVar.colorTextTertiary,
      [stylex.when.ancestor(':hover')]: cssVar.colorText,
    },
    transform: {
      'default': null,
      [stylex.when.ancestor(':hover')]: 'translateX(2px)',
      // At-rules outrank the ancestor selector, so reduced motion cancels the nudge.
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    transition: {
      'default': 'transform 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  card: {
    padding: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: {
      'default': 'border-color 0.15s ease, background 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  cardLink: {
    textDecoration: 'none',
  },
  dropdownTrigger: {
    cursor: 'pointer',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: cssVar.borderRadiusSM,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    transition: {
      'default': 'color 0.15s ease, background 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-1px' },
  },
  // Tonal hero band carrying the headline outcome — the first thing the eye lands on.
  hero: {
    padding: '16px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  heroValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeHeading2,
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorText,
  },
  meta: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
  },
  metaHighlight: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
  },
  monoText: {
    fontFamily: cssVar.fontFamilyCode,
  },
  name: {
    overflow: 'hidden',
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  progressFill: {
    height: '100%',
    borderRadius: '999px',
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
    transition: {
      'default': 'width 0.3s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  progressTrack: {
    overflow: 'hidden',
    width: '100%',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  separator: {
    color: cssVar.colorBorderSecondary,
  },
  stat: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    fontSize: cssVar.fontSizeSM,
  },
  statError: { color: cssVar.colorError },
  statSuccess: { color: cssVar.colorSuccess },
  statWarning: { color: cssVar.colorWarning },
  unit: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
  },
});

interface MetaPart {
  style?: stylex.StyleXStyles;
  text: string;
}

interface RunCardProps {
  benchmarkId: string;
  onEdit?: (run: AgentEvalRunListItem) => void;
  onRefresh?: () => Promise<void>;
  run: AgentEvalRunListItem;
}

const RunCard = memo<RunCardProps>(({ benchmarkId, run, onRefresh, onEdit }) => {
  const { t } = useTranslation('eval');

  const deleteRun = useEvalStore((s) => s.deleteRun);
  const startRun = useEvalStore((s) => s.startRun);
  const abortRun = useEvalStore((s) => s.abortRun);

  const metrics = run.metrics;
  const totalCases = metrics?.totalCases ?? 0;
  const passedCases = metrics?.passedCases ?? 0;
  const failedCases = metrics?.failedCases ?? 0;
  const errorCases = metrics?.errorCases ?? 0;
  const completedCases = passedCases + failedCases + errorCases;
  const progress = totalCases > 0 ? (completedCases / totalCases) * 100 : 0;
  const passRate = metrics?.passRate != null ? metrics.passRate * 100 : 0;
  const hasStats = (run.status === 'completed' || run.status === 'running') && completedCases > 0;
  const canStart = run.status === 'idle' || run.status === 'failed' || run.status === 'aborted';
  const isActive = run.status === 'running' || run.status === 'pending';
  const showProgress = totalCases > 0 && run.status !== 'completed';

  const formatDate = (date?: Date | string) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  };

  const handleStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    confirmModal({
      content: t('run.actions.start.confirm'),
      okText: t('run.actions.start'),
      onOk: async () => {
        try {
          await startRun(run.id, run.status !== 'idle');
          await onRefresh?.();
        } catch (error: any) {
          toast.error(error?.message || 'Failed to start run');
        }
      },
      title: t('run.actions.start'),
    });
  };

  const handleAbort = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    confirmModal({
      content: t('run.actions.abort.confirm'),
      okText: t('run.actions.abort'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await abortRun(run.id);
        await onRefresh?.();
      },
      title: t('run.actions.abort'),
    });
  };

  const handleDelete = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    confirmModal({
      content: t('run.actions.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('run.actions.delete'),
      onOk: async () => {
        await deleteRun(run.id);
        await onRefresh?.();
      },
      title: t('run.actions.delete'),
    });
  };

  const handleEdit = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    onEdit?.(run);
  };

  const menuItems: DropdownItem[] = [
    ...(canStart
      ? [
          {
            icon: <Play size={14} />,
            key: 'start',
            label: t('run.actions.start'),
            onClick: ({ domEvent }: any) => handleStart(domEvent),
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      icon: <Pencil size={14} />,
      key: 'edit',
      label: t('run.actions.edit'),
      onClick: ({ domEvent }: any) => handleEdit(domEvent),
    },
    ...(isActive
      ? [
          {
            danger: true,
            icon: <Square size={14} />,
            key: 'abort',
            label: t('run.actions.abort'),
            onClick: ({ domEvent }: any) => handleAbort(domEvent),
          },
        ]
      : []),
    { type: 'divider' as const },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('run.actions.delete'),
      onClick: ({ domEvent }: any) => handleDelete(domEvent),
    },
  ];

  const metaPartCandidates: Array<MetaPart | false | '' | null | undefined> = [
    run.createdAt && { text: formatDate(run.createdAt) },
    run.datasetName && { text: run.datasetName },
    run.targetAgent?.title && { text: run.targetAgent.title },
    run.targetAgent?.model && {
      style: styles.monoText,
      text: run.targetAgent.model,
    },
    metrics?.duration != null && {
      style: styles.metaHighlight,
      text: formatDuration(metrics.duration),
    },
    metrics?.totalCost != null && {
      style: styles.metaHighlight,
      text: `$${metrics.totalCost.toFixed(2)}`,
    },
  ];
  const metaParts = metaPartCandidates.filter((item): item is MetaPart => Boolean(item));

  return (
    <WorkspaceLink
      className={stylex.props(styles.cardLink).className}
      to={`/eval/bench/${benchmarkId}/runs/${run.id}`}
    >
      <Flexbox {...stylex.props(styles.card, stylex.defaultMarker())} gap={16}>
        {/* Identity row */}
        <Flexbox horizontal align="flex-start" gap={12} justify="space-between">
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <span {...stylex.props(styles.name)}>{run.name}</span>
              <StatusBadge status={run.status} />
            </Flexbox>
            {metaParts.length > 0 && (
              <Flexbox horizontal align="center" {...stylex.props(styles.meta)} gap={4} wrap="wrap">
                {metaParts.map((item, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span {...stylex.props(styles.separator)}>/</span>}
                    <span {...stylex.props(item.style)}>{item.text}</span>
                  </Fragment>
                ))}
              </Flexbox>
            )}
          </Flexbox>
          <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
            <DropdownMenu items={menuItems} placement="bottomRight">
              <span
                {...stylex.props(styles.dropdownTrigger)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <Ellipsis size={16} />
              </span>
            </DropdownMenu>
            <Icon {...stylex.props(styles.arrowIcon)} icon={ArrowRight} size={16} />
          </Flexbox>
        </Flexbox>

        {/* Outcome hero — pass-rate headline + breakdown, or live progress */}
        {showProgress ? (
          <Flexbox {...stylex.props(styles.hero)} gap={10}>
            <Flexbox horizontal align="center" justify="space-between">
              <span {...stylex.props(styles.meta)}>
                {completedCases}/{totalCases}
              </span>
              <span {...stylex.props(styles.metaHighlight)}>{progress.toFixed(0)}%</span>
            </Flexbox>
            <div {...stylex.props(styles.progressTrack)}>
              <div {...sx([styles.progressFill], undefined, { width: `${progress}%` })} />
            </div>
          </Flexbox>
        ) : hasStats ? (
          <Flexbox {...stylex.props(styles.hero)} gap={12}>
            <Flexbox horizontal align="flex-end" gap={16} justify="space-between">
              <Flexbox gap={4}>
                <Flexbox horizontal align="baseline" gap={6}>
                  <span {...stylex.props(styles.heroValue)}>{passRate.toFixed(0)}%</span>
                  <span {...stylex.props(styles.unit)}>{t('run.metrics.passRate')}</span>
                </Flexbox>
              </Flexbox>
              <Flexbox horizontal align="center" gap={12}>
                <span {...stylex.props(styles.stat, styles.statSuccess)}>
                  <Icon icon={CheckCircle2} size={14} />
                  {passedCases}
                </span>
                <span {...stylex.props(styles.stat, styles.statError)}>
                  <Icon icon={XCircle} size={14} />
                  {failedCases}
                </span>
                {errorCases > 0 && (
                  <span {...stylex.props(styles.stat, styles.statWarning)}>
                    <Icon icon={AlertTriangle} size={14} />
                    {errorCases}
                  </span>
                )}
              </Flexbox>
            </Flexbox>
            <SegmentBar
              segments={[
                { color: cssVar.colorSuccess, value: passedCases },
                { color: cssVar.colorError, value: failedCases },
                { color: cssVar.colorWarning, value: errorCases },
              ]}
            />
          </Flexbox>
        ) : null}
      </Flexbox>
    </WorkspaceLink>
  );
});

export default RunCard;
