'use client';

import { AnimatedNumber } from '@lobechat/shared-tool-ui/components';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Tooltip } from '@lobehub/ui';
import { GroupBotIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';
import { aggregateSubagentMetrics } from '@/utils/subagentMetrics';

import { type AgentArgs, ClaudeCodeApiName } from '../../types';
import { resolveCCSubagentType } from '../subagentTypes';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: 0,
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  chipText: {
    overflow: 'hidden',
    minWidth: 0,
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  icon: { flexShrink: 0, marginInline: '6px', color: cssVar.colorTextDescription },
  label: { flexShrink: 0 },
  labelColor: { color: cssVar.colorText },
  metrics: {
    display: 'inline-flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    marginInlineStart: '8px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  metricsDot: { color: cssVar.colorTextQuaternary },
});

const formatTokens = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
};

interface SubagentMetrics {
  hasAny: boolean;
  model?: string;
  toolCalls: number;
  totalTokens: number;
}

/**
 * Subagent metrics for the chip, derived from the child messages via the shared
 * `aggregateSubagentMetrics` (tool count, SUM of every turn's
 * `usage.totalTokens`, pinned model).
 *
 * Two data sources, ONE rule:
 *  - **Live** (streaming / still hydrated): aggregate the in-memory child
 *    messages from `dbMessagesMap`.
 *  - **Cold-load**: the child messages aren't hydrated, so fall back to the
 *    `thread.metadata.*` totals the server derives in `threadModel.queryByTopicId`
 *    — which runs the SAME aggregation in SQL over the SAME rows, so the two
 *    paths can't diverge.
 */
const useSubagentMetrics = (toolCallId: string | undefined): SubagentMetrics | null =>
  useChatStore((s) => {
    if (!toolCallId) return null;
    const thread = (threadSelectors.currentTopicThreads(s) ?? []).find(
      (t) => t.metadata?.sourceToolCallId === toolCallId,
    );
    if (!thread) return null;

    const live = aggregateSubagentMetrics(threadSelectors.getThreadDbMessages(thread.id)(s));

    // Live values win when the child messages are present; otherwise read the
    // server-derived rollup off `thread.metadata`.
    const toolCalls = live.toolCalls || thread.metadata?.totalToolCalls || 0;
    const totalTokens = live.totalTokens || thread.metadata?.totalTokens || 0;
    const model = live.model || thread.metadata?.model;

    return {
      hasAny: toolCalls > 0 || totalTokens > 0 || !!model,
      model,
      toolCalls,
      totalTokens,
    };
  });

/**
 * CC's subagent-spawn tool. `subagent_type` ("Explore", "general-purpose", ...)
 * is the variant; we prefix it with "Agent:" so the row visibly reads as a
 * subagent dispatch rather than a regular tool — the icon alone isn't enough
 * signal. `description` is the 3-5 word title the model writes and goes in the
 * chip; the full `prompt` is too long for a collapsed header.
 *
 * The trailing metrics segment (tool count · tokens) is sourced from the
 * subagent's child thread when one exists. It updates live during streaming so
 * users get a progress sense, and is hydrated from `thread.metadata` after
 * finalize. Model name lives in the tooltip to keep the inline row compact.
 */
export const AgentInspector = memo<BuiltinInspectorProps<AgentArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, toolCallId }) => {
    const { t } = useTranslation('plugin');
    const { t: tChat } = useTranslation('chat');
    const fallbackLabel = t(ClaudeCodeApiName.Agent as any);

    const source = args ?? partialArgs;
    const description = source?.description?.trim();
    const subagentType = source?.subagent_type?.trim();

    const isShiny = isArgumentsStreaming || isLoading;

    const resolved = resolveCCSubagentType(subagentType);
    const Icon = resolved?.icon ?? GroupBotIcon;
    const labelText = resolved?.label ?? fallbackLabel;

    const metrics = useSubagentMetrics(toolCallId);

    const tooltipLines: string[] = [];
    if (metrics?.model) {
      tooltipLines.push(`${tChat('thread.subagentMetrics.modelLabel')}: ${metrics.model}`);
    }
    if (metrics && metrics.toolCalls > 0) {
      tooltipLines.push(
        tChat('thread.subagentMetrics.toolCalls', { count: metrics.toolCalls }) as string,
      );
    }
    if (metrics && metrics.totalTokens > 0) {
      tooltipLines.push(
        tChat('thread.subagentMetrics.tokens', {
          count: metrics.totalTokens.toLocaleString('en-US'),
        }) as string,
      );
    }

    const metricsNode =
      metrics?.hasAny && (metrics.toolCalls > 0 || metrics.totalTokens > 0) ? (
        <Tooltip title={tooltipLines.length > 0 ? tooltipLines.join(' · ') : undefined}>
          <span {...stylex.props(styles.metrics)}>
            {metrics.toolCalls > 0 && (
              <span>
                {tChat('thread.subagentMetrics.toolsShort', { count: metrics.toolCalls })}
              </span>
            )}
            {metrics.toolCalls > 0 && metrics.totalTokens > 0 && (
              <span {...stylex.props(styles.metricsDot)}>·</span>
            )}
            {metrics.totalTokens > 0 && (
              <span>
                <AnimatedNumber
                  duration={2000}
                  formatter={formatTokens}
                  value={metrics.totalTokens}
                />
              </span>
            )}
          </span>
        </Tooltip>
      ) : null;

    return (
      <div className={inspectorTextStyles.root}>
        <span
          className={cx(
            stylex.props(styles.label, !isShiny && styles.labelColor).className,
            isShiny && shinyTextStyles.shinyText,
          )}
        >
          Agent:
        </span>
        <Icon className={stylex.props(styles.icon).className} size={14} />
        <span {...stylex.props(styles.label, styles.labelColor)}>{labelText}</span>
        {description && (
          <span {...stylex.props(styles.chip)}>
            <span {...stylex.props(styles.chipText)}>{description}</span>
          </span>
        )}
        {metricsNode}
      </div>
    );
  },
);

AgentInspector.displayName = 'ClaudeCodeAgentInspector';
