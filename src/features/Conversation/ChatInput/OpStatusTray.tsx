'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ClockIcon, CoinsIcon, DollarSignIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';

import { contextSelectors, dataSelectors, useConversationStore } from '../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 6px;
    padding-inline: 12px;
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
  metric: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-variant-numeric: tabular-nums;
  `,
  metricGroup: css`
    display: inline-flex;
    gap: 12px;
    align-items: center;
  `,
  value: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorText};
  `,
}));

const formatDuration = (ms: number) => {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const formatTokens = (n: number) => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
};

const formatCost = (cost: number) => {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
};

interface OpStatusTrayProps {
  /**
   * Square the top corners when another panel sits flush above this one.
   */
  topAttached?: boolean;
}

const OpStatusTray = memo<OpStatusTrayProps>(({ topAttached }) => {
  const context = useConversationStore(contextSelectors.context);
  const dbMessages = useConversationStore(dataSelectors.dbMessages);

  // Pick the earliest-started running AI-runtime op as the "current op".
  // Sub-operations (callLLM, toolCalling, ...) are excluded by filtering on
  // AI_RUNTIME_OPERATION_TYPES, which only lists user-facing top-level types.
  const startTime = useChatStore((s) => {
    const ops = operationSelectors.getOperationsByContext(context)(s);
    let earliest: number | undefined;
    for (const op of ops) {
      if (
        op.status !== 'running' ||
        op.metadata.isAborting ||
        !AI_RUNTIME_OPERATION_TYPES.includes(op.type)
      ) {
        continue;
      }
      if (earliest === undefined || op.metadata.startTime < earliest) {
        earliest = op.metadata.startTime;
      }
    }
    return earliest;
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startTime) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  // Aggregate token + cost across assistant messages produced since this op
  // started. Allow a small tolerance for clock skew between op startTime
  // (Date.now()) and message.createdAt (DB timestamp).
  const { totalTokens, totalCost } = useMemo(() => {
    if (!startTime) return { totalCost: 0, totalTokens: 0 };
    const TOLERANCE_MS = 2000;
    let tokens = 0;
    let cost = 0;
    for (const m of dbMessages) {
      if (m.role !== 'assistant') continue;
      if (!m.createdAt || m.createdAt < startTime - TOLERANCE_MS) continue;
      const usage = m.metadata?.usage;
      if (!usage) continue;
      tokens += usage.totalTokens ?? 0;
      cost += usage.cost ?? 0;
    }
    return { totalCost: cost, totalTokens: tokens };
  }, [dbMessages, startTime]);

  if (!startTime) return null;

  const elapsed = now - startTime;

  return (
    <Flexbox
      horizontal
      align="center"
      className={cx(styles.container, topAttached && styles.containerTopAttached)}
      justify="space-between"
    >
      <span className={styles.metric}>
        <Icon icon={ClockIcon} size={12} />
        <span className={styles.value}>{formatDuration(elapsed)}</span>
      </span>

      <span className={styles.metricGroup}>
        <span className={styles.metric}>
          <Icon icon={CoinsIcon} size={12} />
          <span className={styles.value}>{formatTokens(totalTokens)}</span>
        </span>
        <span className={styles.metric}>
          <Icon icon={DollarSignIcon} size={12} />
          <span className={styles.value}>{formatCost(totalCost)}</span>
        </span>
      </span>
    </Flexbox>
  );
});

OpStatusTray.displayName = 'OpStatusTray';

export default OpStatusTray;
