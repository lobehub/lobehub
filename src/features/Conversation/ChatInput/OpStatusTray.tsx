'use client';

import { formatElapsedClockTime } from '@lobechat/utils';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { CircleDollarSignIcon, CoinsIcon, FootprintsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { shinyTextStyles } from '@/styles';
import { calculateOperationUsageMetrics } from '@/utils/operationUsageMetrics';

import { contextSelectors, dataSelectors, useConversationStore } from '../store';
import { type ActivityKey, resolveOperationActivity } from '../utils/operationActivity';
import AnimatedCount from './OpStatusTray/AnimatedCount';
import { parseStatusPhrases, pickRotatingStatusPhrase } from './OpStatusTray/logic';

// Cycle the generating phrase like a carousel so a long-running task doesn't
// stare back with the same line the whole time.
const STATUS_PHRASE_ROTATION_MS = 4000;

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
const NARROW = '@container (max-width: 360px)';
const NARROWER = '@container (max-width: 260px)';

const phraseEnter = stylex.keyframes({
  from: { transform: 'translateY(3px)', opacity: 0 },
  to: { transform: 'translateY(0)', opacity: 1 },
});

const glyphSpin = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

const glyphCore = stylex.keyframes({
  '0%, 100%': { transform: 'scale(0.86)', opacity: 0.9 },
  '50%': { transform: 'scale(1)', opacity: 1 },
});

const styles = stylex.create({
  container: {
    containerType: 'inline-size',
    paddingBlock: '8px',
    paddingInline: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillSecondary,
    borderBlockEndWidth: 0,
    borderStartStartRadius: '12px',
    borderStartEndRadius: '12px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  containerTopAttached: { borderStartStartRadius: 0, borderStartEndRadius: 0 },
  // Keeps a hairline divider on top so the tray still reads as separated from
  // the conversation above, even without the full card chrome.
  containerSeamless: {
    borderWidth: 0,
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderStartStartRadius: 0,
    borderStartEndRadius: 0,
    borderEndStartRadius: 0,
    borderEndEndRadius: 0,
    backgroundColor: 'transparent',
  },
  divider: {
    width: '1px',
    height: '12px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  metric: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  metricGroup: { display: 'inline-flex', flex: 'none', gap: '10px', alignItems: 'center' },
  // Composed after `metricGroup`: a conditional value replaces the whole
  // property, so the resting display is restated here.
  metricGroupFull: { display: { default: 'inline-flex', [NARROW]: 'none' } },
  metricIcon: { flex: 'none', color: cssVar.colorTextTertiary },
  metricPopover: { minWidth: '150px', padding: '2px' },
  metricPopoverLabel: { color: cssVar.colorTextTertiary },
  metricPopoverRow: { fontSize: '12px' },
  metricPopoverValue: { fontVariantNumeric: 'tabular-nums', color: cssVar.colorTextSecondary },
  metricValue: { overflow: 'hidden', maxWidth: '56px', textOverflow: 'ellipsis' },
  compactMetric: {
    cursor: 'default',
    display: { default: 'none', [NARROW]: 'inline-flex' },
    flex: 'none',
  },
  statusMetric: {
    overflow: 'hidden',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
  },
  statusText: {
    overflow: 'hidden',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusPhrase: {
    display: 'inline-block',
    animationName: phraseEnter,
    animationDuration: '0.4s',
    animationTimingFunction: 'ease',
  },
  timerValue: {
    flex: 'none',
    color: cssVar.colorTextTertiary,
    display: { default: null, [NARROWER]: 'none' },
  },
  activityGlyph: {
    overflow: 'visible',
    flex: 'none',
    width: '16px',
    height: '16px',
    color: cssVar.colorPrimary,
  },
  glyphCore: {
    transformOrigin: 'center',
    transformBox: 'fill-box',
    fill: cssVar.colorPrimary,
    animationName: { default: glyphCore, [REDUCED_MOTION]: 'none' },
    animationDuration: '1.5s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  glyphOrbit: {
    transformOrigin: 'center',
    transformBox: 'fill-box',
    fill: 'none',
    stroke: `color-mix(in srgb, ${cssVar.colorPrimary} 76%, transparent)`,
    strokeDasharray: '9 18',
    strokeLinecap: 'round',
    strokeWidth: 1.5,
    animationName: { default: glyphSpin, [REDUCED_MOTION]: 'none' },
    animationDuration: '2s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
});

const ActivityGlyph = () => (
  <svg aria-hidden {...stylex.props(styles.activityGlyph)} viewBox="0 0 16 16">
    <circle {...stylex.props(styles.glyphOrbit)} cx="8" cy="8" r="6.1" />
    <circle {...stylex.props(styles.glyphCore)} cx="8" cy="8" r="2.7" />
  </svg>
);

const formatTokens = (n: number) => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
};

const formatCost = (cost: number) => {
  if (cost < 0.01) return cost.toFixed(4);
  return cost.toFixed(2);
};

const normalizeCount = (count: unknown) => {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
};

interface OpStatusTrayProps {
  /**
   * Drop the card chrome (background, border, rounded corners) so the status
   * reads as a plain inline row — used when nothing is flush below it to attach to.
   */
  seamless?: boolean;
  /**
   * Square the top corners when another panel sits flush above this one.
   */
  topAttached?: boolean;
}

interface MetricItem {
  icon: LucideIcon;
  key: 'cost' | 'llmCalls' | 'tokens';
  label: string;
  title: string;
  value: ReactNode;
}

const OpStatusTray = memo<OpStatusTrayProps>(({ seamless, topAttached }) => {
  const { t } = useTranslation(['chat', 'opStatusTray']);
  const context = useConversationStore(contextSelectors.context);
  const dbMessages = useConversationStore(dataSelectors.dbMessages);

  const operationState = useChatStore((s) => {
    const ops = operationSelectors.getOperationsByContext(context)(s);
    let activity: ActivityKey | undefined;
    let earliestStart: number | undefined;
    let latestActivityStart = -1;
    let llmCalls = 0;
    let statusSeed: string | undefined;
    const runtimeOperationIds: string[] = [];

    for (const op of ops) {
      if (op.status !== 'running' || op.metadata.isAborting || op.metadata.visibleLoadingDone)
        continue;

      const mapped = resolveOperationActivity(op.type);
      if (mapped && op.metadata.startTime > latestActivityStart) {
        latestActivityStart = op.metadata.startTime;
        activity = mapped;
      }

      const isSteeredSend = op.type === 'sendMessage' && op.metadata.turnStartTime !== undefined;
      if (!AI_RUNTIME_OPERATION_TYPES.includes(op.type) && !isSteeredSend) {
        continue;
      }

      runtimeOperationIds.push(op.id);
      // Prefer the explicit LLM-call total; older servers only sent the
      // execution step index, which is the best available fallback.
      const opLlmCalls =
        typeof op.metadata.llmCalls === 'number'
          ? normalizeCount(op.metadata.llmCalls)
          : normalizeCount(op.metadata.stepCount);
      llmCalls = Math.max(llmCalls, opLlmCalls);

      const turnStartTime = op.metadata.turnStartTime ?? op.metadata.startTime;
      if (earliestStart === undefined || turnStartTime < earliestStart) {
        earliestStart = turnStartTime;
        statusSeed = op.id;
      }
    }
    return {
      activity: activity ?? 'generating',
      llmCalls,
      operationIdsKey: runtimeOperationIds.join('|'),
      startTime: earliestStart,
      statusSeed,
    };
  });
  const operationsByMessage = useChatStore((s) => s.operationsByMessage);
  const handoffStartTime = useChatStore((s) =>
    operationSelectors.isSteerHandoffPending(context)(s)
      ? operationSelectors.getLatestAgentRuntimeTurnStartTime(context)(s)
      : undefined,
  );
  const startTime = operationState.startTime ?? handoffStartTime;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startTime) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const operationIds = useMemo(
    () => new Set(operationState.operationIdsKey.split('|').filter(Boolean)),
    [operationState.operationIdsKey],
  );

  // Single source of truth: derive the operation total from the same per-message
  // usage shown on each bubble, so the tray always equals their sum. (Updates as
  // messages refresh — no separate live accumulation that can drift.)
  const usageMetrics = useMemo(() => {
    return calculateOperationUsageMetrics(dbMessages, operationIds, operationsByMessage);
  }, [dbMessages, operationIds, operationsByMessage]);

  if (!startTime) return null;

  const { totalCost, totalTokens } = usageMetrics;
  const elapsed = now - startTime;
  const costLabel = t('chat:opStatusTray.cost');
  const llmCallsLabel = t('chat:opStatusTray.llmCalls');
  const tokenLabel = t('chat:opStatusTray.tokens', { defaultValue: 'tokens' });
  const generatingPhrases = parseStatusPhrases(
    t('opStatusTray:generatingPhrases', {
      defaultValue: [],
      returnObjects: true,
    }),
  );
  const rotationStep = Math.floor(elapsed / STATUS_PHRASE_ROTATION_MS);
  const randomGeneratingStatus =
    pickRotatingStatusPhrase(
      generatingPhrases,
      operationState.statusSeed ?? String(startTime),
      rotationStep,
    ) ?? t('chat:opStatusTray.status.generating');
  const statusText =
    operationState.activity === 'generating'
      ? randomGeneratingStatus
      : t(`chat:opStatusTray.status.${operationState.activity}`);

  // Zero-valued metrics render nothing. LLM calls are the user-facing "step"
  // metric: tool-only iterations never increment it.
  const metricCandidates: (MetricItem | undefined)[] = [
    operationState.llmCalls > 0
      ? {
          icon: FootprintsIcon,
          key: 'llmCalls',
          label: llmCallsLabel,
          title: `${operationState.llmCalls} ${llmCallsLabel}`,
          value: String(operationState.llmCalls),
        }
      : undefined,
    totalTokens > 0
      ? {
          icon: CoinsIcon,
          key: 'tokens',
          label: tokenLabel,
          title: `${formatTokens(totalTokens)} ${tokenLabel}`,
          value: <AnimatedCount format={formatTokens} value={totalTokens} />,
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
  ];
  const metrics = metricCandidates.filter((item): item is MetricItem => !!item);
  const tokenMetric = metrics.find((metric) => metric.key === 'tokens');

  const renderMetric = ({ icon, title, value }: MetricItem) => (
    <Tooltip title={title}>
      <span {...stylex.props(styles.metric)}>
        <Icon {...stylex.props(styles.metricIcon)} icon={icon} size={13} />
        <span {...stylex.props(styles.metricValue)}>{value}</span>
      </span>
    </Tooltip>
  );

  const metricPopoverContent = (
    <Flexbox {...stylex.props(styles.metricPopover)} gap={8}>
      {metrics.map(({ icon, key, label, value }) => (
        <Flexbox
          horizontal
          align="center"
          {...stylex.props(styles.metricPopoverRow)}
          gap={20}
          justify="space-between"
          key={key}
        >
          <span {...stylex.props(styles.metric, styles.metricPopoverLabel)}>
            <Icon {...stylex.props(styles.metricIcon)} icon={icon} size={13} />
            <span>{label}</span>
          </span>
          <span {...stylex.props(styles.metricPopoverValue)}>{value}</span>
        </Flexbox>
      ))}
    </Flexbox>
  );

  return (
    <Flexbox
      horizontal
      align="center"
      justify="space-between"
      {...stylex.props(
        styles.container,
        topAttached && styles.containerTopAttached,
        seamless && styles.containerSeamless,
      )}
    >
      <span {...stylex.props(styles.metric, styles.statusMetric)}>
        <ActivityGlyph />
        <span {...stylex.props(styles.statusText)}>
          <span {...stylex.props(styles.statusPhrase)} key={statusText}>
            <span className={shinyTextStyles.shinyText}>{statusText}...</span>
          </span>
        </span>
        <span {...stylex.props(styles.timerValue)}>{formatElapsedClockTime(elapsed)}</span>
      </span>

      {metrics.length > 0 && (
        <>
          <span {...stylex.props(styles.metricGroup, styles.metricGroupFull)}>
            {metrics.map((metric, i) => (
              <Fragment key={metric.key}>
                {i > 0 && <span {...stylex.props(styles.divider)} />}
                {renderMetric(metric)}
              </Fragment>
            ))}
          </span>
          {tokenMetric && (
            <Popover content={metricPopoverContent} placement="topRight" trigger="hover">
              <span {...stylex.props(styles.metric, styles.compactMetric)}>
                <Icon {...stylex.props(styles.metricIcon)} icon={tokenMetric.icon} size={13} />
                <span {...stylex.props(styles.metricValue)}>{tokenMetric.value}</span>
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
