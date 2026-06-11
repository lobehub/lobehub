'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { CircleDollarSignIcon, HammerIcon, HashIcon, Repeat2Icon, TimerIcon } from 'lucide-react';
import { Fragment, memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import {
  AI_RUNTIME_OPERATION_TYPES,
  type OperationType,
} from '@/store/chat/slices/operation/types';

import { contextSelectors, dataSelectors, useConversationStore } from '../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
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
  `,
  metricGroup: css`
    display: inline-flex;
    gap: 10px;
    align-items: center;
  `,
  pulse: css`
    position: relative;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};

    &::before {
      content: '';

      position: absolute;
      inset: 0;

      border-radius: 50%;

      background: ${cssVar.colorSuccess};

      animation: op-status-tray-ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite;
    }

    @keyframes op-status-tray-ping {
      0% {
        transform: scale(1);
        opacity: 0.7;
      }

      80%,
      100% {
        transform: scale(2.8);
        opacity: 0;
      }
    }
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
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
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

const OpStatusTray = memo<OpStatusTrayProps>(({ topAttached }) => {
  const { t } = useTranslation('chat');
  const context = useConversationStore(contextSelectors.context);
  const dbMessages = useConversationStore(dataSelectors.dbMessages);

  // Detect any running AI-runtime op (excludes sub-ops like callLLM/toolCalling)
  // and capture the earliest start time as the op's anchor.
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

  // The most recently started running sub-op decides the streaming phase.
  // Server-side runtimes surface no sub-ops on the client, so fall back to
  // 'generating' — the dominant phase for plain server-streamed chat.
  const activity = useChatStore((s): ActivityKey => {
    const ops = operationSelectors.getOperationsByContext(context)(s);
    let current: ActivityKey | undefined;
    let latest = -1;
    for (const op of ops) {
      if (op.status !== 'running' || op.metadata.isAborting) continue;
      const mapped = resolveActivity(op.type);
      if (!mapped) continue;
      if (op.metadata.startTime > latest) {
        latest = op.metadata.startTime;
        current = mapped;
      }
    }
    return current ?? 'generating';
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startTime) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  // Aggregate turns / tool calls / tokens / cost across the current
  // conversation. `usage` lives on the top-level message field for the
  // standard agent-runtime path; the heterogeneous executor only writes
  // `metadata.usage`. Read both. Time-based filtering proved unreliable (the
  // assistant message can be created before the AI_RUNTIME op's startTime),
  // so we total the whole session — within a fresh topic this matches
  // "current op" anyway.
  const { toolCalls, totalCost, totalTokens, turns } = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    let turnCount = 0;
    let toolCount = 0;
    for (const m of dbMessages) {
      if (m.role === 'tool') {
        toolCount += 1;
        continue;
      }
      if (m.role !== 'assistant') continue;
      turnCount += 1;
      const usage = m.usage ?? m.metadata?.usage;
      if (!usage) continue;
      tokens += usage.totalTokens ?? 0;
      cost += usage.cost ?? 0;
    }
    return { toolCalls: toolCount, totalCost: cost, totalTokens: tokens, turns: turnCount };
  }, [dbMessages]);

  if (!startTime) return null;

  const elapsed = now - startTime;

  // Zero-valued metrics render nothing; turns only matter for long-running
  // multi-turn tasks, so a single turn stays hidden too.
  const metrics: ReactNode[] = [];
  if (turns > 1)
    metrics.push(
      <span className={styles.metric} key="turns">
        <Icon icon={Repeat2Icon} size={13} />
        <span className={styles.value}>{turns}</span>
        <span>{t('opStatusTray.turns')}</span>
      </span>,
    );
  if (toolCalls > 0)
    metrics.push(
      <span className={styles.metric} key="toolCalls">
        <Icon icon={HammerIcon} size={13} />
        <span className={styles.value}>{toolCalls}</span>
        <span>{t('opStatusTray.toolCalls')}</span>
      </span>,
    );
  if (totalTokens > 0)
    metrics.push(
      <span className={styles.metric} key="tokens">
        <Icon icon={HashIcon} size={13} />
        <span className={styles.value}>{formatTokens(totalTokens)}</span>
        <span>tokens</span>
      </span>,
    );
  if (totalCost > 0)
    metrics.push(
      <span className={styles.metric} key="cost">
        <Icon icon={CircleDollarSignIcon} size={13} />
        <span className={styles.value}>{formatCost(totalCost)}</span>
      </span>,
    );

  return (
    <Flexbox
      horizontal
      align="center"
      className={cx(styles.container, topAttached && styles.containerTopAttached)}
      justify="space-between"
    >
      <span className={styles.metric}>
        <span className={styles.pulse} />
        <span>{t(`opStatusTray.status.${activity}`)}</span>
        <Icon icon={TimerIcon} size={13} />
        <span className={styles.value}>{formatDuration(elapsed)}</span>
      </span>

      {metrics.length > 0 && (
        <span className={styles.metricGroup}>
          {metrics.map((node, i) => (
            <Fragment key={i}>
              {i > 0 && <span className={styles.divider} />}
              {node}
            </Fragment>
          ))}
        </span>
      )}
    </Flexbox>
  );
});

OpStatusTray.displayName = 'OpStatusTray';

export default OpStatusTray;
