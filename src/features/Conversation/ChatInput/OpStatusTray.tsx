'use client';

import { formatElapsedClockTime } from '@lobechat/utils';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { CircleDollarSignIcon, CoinsIcon, FootprintsIcon } from 'lucide-react';
import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import {
  AI_RUNTIME_OPERATION_TYPES,
  type OperationType,
} from '@/store/chat/slices/operation/types';
import { shinyTextStyles } from '@/styles';
import {
  calculateOperationUsageMetrics,
  hasOperationUsageMetrics,
  mergeOperationUsageMetrics,
  type OperationUsageMetrics,
} from '@/utils/operationUsageMetrics';

import { contextSelectors, dataSelectors, useConversationStore } from '../store';
import { parseStatusPhrases, pickStableStatusPhrase } from './OpStatusTray/logic';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    container-type: inline-size;

    padding-block: 8px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-block-end: none;
    border-start-start-radius: 12px;
    border-start-end-radius: 12px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgElevated};
  `,
  containerTopAttached: css`
    border-start-start-radius: 0;
    border-start-end-radius: 0;
  `,
  divider: css`
    width: 1px;
    height: 12px;
    background: ${cssVar.colorBorderSecondary};
  `,
  metric: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  `,
  metricGroup: css`
    display: inline-flex;
    flex: none;
    gap: 10px;
    align-items: center;
  `,
  metricGroupFull: css`
    @container (max-width: 360px) {
      display: none;
    }
  `,
  metricIcon: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  metricPopover: css`
    min-width: 150px;
    padding: 2px;
  `,
  metricPopoverLabel: css`
    color: ${cssVar.colorTextTertiary};
  `,
  metricPopoverRow: css`
    font-size: 12px;
  `,
  metricPopoverValue: css`
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
  `,
  metricValue: css`
    overflow: hidden;
    max-width: 56px;
    text-overflow: ellipsis;
  `,
  compactMetric: css`
    cursor: default;
    display: none;
    flex: none;

    @container (max-width: 360px) {
      display: inline-flex;
    }
  `,
  statusMetric: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
  `,
  statusText: css`
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  timerValue: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};

    @container (max-width: 260px) {
      display: none;
    }
  `,
  activityGlyph: css`
    overflow: visible;
    flex: none;

    width: 16px;
    height: 16px;

    color: ${cssVar.colorPrimary};

    @keyframes op-status-tray-glyph-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes op-status-tray-glyph-core {
      0%,
      100% {
        transform: scale(0.86);
        opacity: 0.9;
      }

      50% {
        transform: scale(1);
        opacity: 1;
      }
    }
  `,
  glyphCore: css`
    transform-origin: center;
    transform-box: fill-box;
    fill: ${cssVar.colorPrimary};
    animation: op-status-tray-glyph-core 1.5s ease-in-out infinite;
  `,
  glyphOrbit: css`
    transform-origin: center;
    transform-box: fill-box;

    fill: none;
    stroke: color-mix(in srgb, ${cssVar.colorPrimary} 76%, transparent);
    stroke-dasharray: 9 18;
    stroke-linecap: round;
    stroke-width: 1.5;

    animation: op-status-tray-glyph-spin 2s linear infinite;
  `,
}));

const ActivityGlyph = memo(() => (
  <svg aria-hidden className={styles.activityGlyph} viewBox="0 0 16 16">
    <circle className={styles.glyphOrbit} cx="8" cy="8" r="6.1" />
    <circle className={styles.glyphCore} cx="8" cy="8" r="2.7" />
  </svg>
));

ActivityGlyph.displayName = 'ActivityGlyph';

const formatTokens = (n: number) => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
};

const formatCost = (cost: number) => {
  if (cost < 0.01) return cost.toFixed(4);
  return cost.toFixed(2);
};

const normalizeStepCount = (stepCount: unknown) => {
  if (typeof stepCount !== 'number' || !Number.isFinite(stepCount)) return 0;
  return Math.max(0, Math.floor(stepCount));
};

type ActivityKey = 'compressing' | 'generating' | 'reasoning' | 'searching' | 'toolCalling';

/**
 * Map a running sub-operation type to the streaming phase shown on the left.
 * Container ops (AI_RUNTIME) and bookkeeping ops return undefined.
 */
const resolveActivity = (type: OperationType): ActivityKey | undefined => {
  if (type === 'reasoning') return 'reasoning';
  if (
    type === 'toolCalling' ||
    type === 'executeToolCall' ||
    type === 'createToolMessage' ||
    type === 'pluginApi' ||
    type.startsWith('builtinTool')
  )
    return 'toolCalling';
  if (type === 'rag' || type === 'searchWorkflow') return 'searching';
  if (type === 'contextCompression' || type === 'generateSummary') return 'compressing';
  if (
    type === 'callLLM' ||
    type === 'groupAgentStream' ||
    type === 'createAssistantMessage' ||
    type === 'supervisorDecision'
  )
    return 'generating';
  return undefined;
};

interface OpStatusTrayProps {
  /**
   * Square the top corners when another panel sits flush above this one.
   */
  topAttached?: boolean;
}

interface MetricItem {
  icon: LucideIcon;
  key: 'cost' | 'steps' | 'tokens';
  label: string;
  title: string;
  value: string;
}

const OpStatusTray = memo<OpStatusTrayProps>(({ topAttached }) => {
  const { t } = useTranslation(['chat', 'opStatusTray']);
  const context = useConversationStore(contextSelectors.context);
  const dbMessages = useConversationStore(dataSelectors.dbMessages);

  const operationState = useChatStore((s) => {
    const ops = operationSelectors.getOperationsByContext(context)(s);
    let activity: ActivityKey | undefined;
    let earliestStart: number | undefined;
    let latestActivityStart = -1;
    let statusSeed: string | undefined;
    let stepCount = 0;
    let usageMetrics: OperationUsageMetrics | undefined;
    const runtimeOperationIds: string[] = [];

    for (const op of ops) {
      if (op.status !== 'running' || op.metadata.isAborting) continue;

      const mapped = resolveActivity(op.type);
      if (mapped && op.metadata.startTime > latestActivityStart) {
        latestActivityStart = op.metadata.startTime;
        activity = mapped;
      }

      if (!AI_RUNTIME_OPERATION_TYPES.includes(op.type)) {
        continue;
      }

      runtimeOperationIds.push(op.id);
      stepCount = Math.max(stepCount, normalizeStepCount(op.metadata.stepCount));
      if (hasOperationUsageMetrics(op.metadata.usageMetrics)) {
        usageMetrics = mergeOperationUsageMetrics(usageMetrics, op.metadata.usageMetrics);
      }

      if (earliestStart === undefined || op.metadata.startTime < earliestStart) {
        earliestStart = op.metadata.startTime;
        statusSeed = op.id;
      }
    }
    return {
      activity: activity ?? 'generating',
      operationIdsKey: runtimeOperationIds.join('|'),
      startTime: earliestStart,
      statusSeed,
      steps: stepCount,
      usageMetrics,
    };
  });
  const operationsByMessage = useChatStore((s) => s.operationsByMessage);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!operationState.startTime) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [operationState.startTime]);

  const operationIds = useMemo(
    () => new Set(operationState.operationIdsKey.split('|').filter(Boolean)),
    [operationState.operationIdsKey],
  );

  // Fallback for older / reloaded operation state: derive usage from messages
  // produced by this operation when live operation metadata is unavailable.
  const fallbackMetrics = useMemo(() => {
    return calculateOperationUsageMetrics(dbMessages, operationIds, operationsByMessage);
  }, [dbMessages, operationIds, operationsByMessage]);

  if (!operationState.startTime) return null;

  const { totalCost, totalTokens } = hasOperationUsageMetrics(operationState.usageMetrics)
    ? operationState.usageMetrics
    : fallbackMetrics;
  const elapsed = now - operationState.startTime;
  const costLabel = t('chat:opStatusTray.cost');
  const stepLabel = t('chat:opStatusTray.steps');
  const tokenLabel = t('chat:opStatusTray.tokens', { defaultValue: 'tokens' });
  const generatingPhrases = parseStatusPhrases(
    t('opStatusTray:generatingPhrases', {
      defaultValue: [],
      returnObjects: true,
    }),
  );
  const randomGeneratingStatus =
    pickStableStatusPhrase(
      generatingPhrases,
      operationState.statusSeed ?? String(operationState.startTime),
    ) ?? t('chat:opStatusTray.status.generating');
  const statusText =
    operationState.activity === 'generating'
      ? randomGeneratingStatus
      : t(`chat:opStatusTray.status.${operationState.activity}`);

  // Zero-valued metrics render nothing; steps only matter for long-running
  // multi-step tasks, so a single step stays hidden too.
  const metrics = [
    operationState.steps > 1
      ? {
          icon: FootprintsIcon,
          key: 'steps',
          label: stepLabel,
          title: `${operationState.steps} ${stepLabel}`,
          value: String(operationState.steps),
        }
      : undefined,
    totalTokens > 0
      ? {
          icon: CoinsIcon,
          key: 'tokens',
          label: tokenLabel,
          title: `${formatTokens(totalTokens)} ${tokenLabel}`,
          value: formatTokens(totalTokens),
        }
      : undefined,
    totalCost > 0
      ? {
          icon: CircleDollarSignIcon,
          key: 'cost',
          label: costLabel,
          title: `${costLabel}: ${formatCost(totalCost)}`,
          value: formatCost(totalCost),
        }
      : undefined,
  ].filter((item): item is MetricItem => !!item);
  const tokenMetric = metrics.find((metric) => metric.key === 'tokens');

  const renderMetric = ({ icon, title, value }: MetricItem) => (
    <Tooltip title={title}>
      <span className={styles.metric}>
        <Icon className={styles.metricIcon} icon={icon} size={13} />
        <span className={styles.metricValue}>{value}</span>
      </span>
    </Tooltip>
  );

  const metricPopoverContent = (
    <Flexbox className={styles.metricPopover} gap={8}>
      {metrics.map(({ icon, key, label, value }) => (
        <Flexbox
          horizontal
          align="center"
          className={styles.metricPopoverRow}
          gap={20}
          justify="space-between"
          key={key}
        >
          <span className={cx(styles.metric, styles.metricPopoverLabel)}>
            <Icon className={styles.metricIcon} icon={icon} size={13} />
            <span>{label}</span>
          </span>
          <span className={styles.metricPopoverValue}>{value}</span>
        </Flexbox>
      ))}
    </Flexbox>
  );

  return (
    <Flexbox
      horizontal
      align="center"
      className={cx(styles.container, topAttached && styles.containerTopAttached)}
      justify="space-between"
    >
      <span className={cx(styles.metric, styles.statusMetric)}>
        <ActivityGlyph />
        <span className={cx(styles.statusText, shinyTextStyles.shinyText)}>{statusText}...</span>
        <span className={styles.timerValue}>{formatElapsedClockTime(elapsed)}</span>
      </span>

      {metrics.length > 0 && (
        <>
          <span className={cx(styles.metricGroup, styles.metricGroupFull)}>
            {metrics.map((metric, i) => (
              <Fragment key={metric.key}>
                {i > 0 && <span className={styles.divider} />}
                {renderMetric(metric)}
              </Fragment>
            ))}
          </span>
          {tokenMetric && (
            <Popover content={metricPopoverContent} placement="topRight" trigger="hover">
              <span className={cx(styles.metric, styles.compactMetric)}>
                <Icon className={styles.metricIcon} icon={tokenMetric.icon} size={13} />
                <span className={styles.metricValue}>{tokenMetric.value}</span>
              </span>
            </Popover>
          )}
        </>
      )}
    </Flexbox>
  );
});

OpStatusTray.displayName = 'OpStatusTray';

export default OpStatusTray;
