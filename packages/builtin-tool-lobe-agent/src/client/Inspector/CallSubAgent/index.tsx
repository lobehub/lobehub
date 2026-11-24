'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx, useTheme } from '@lobehub/ui';
import { GroupBotIcon } from '@lobehub/ui/icons';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CallSubAgentParams, CallSubAgentState } from '../../../types';
import { SubAgentStats } from '../../components/SubAgentStats';

const styles = createStaticStyles(({ css, cssVar }) => ({
  background: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  label: css`
    flex-shrink: 0;
    color: ${cssVar.colorText};
  `,
  root: css`
    gap: 6px;
  `,
}));

/**
 * Collapsed row for lobe-agent's `callSubAgent`. Mirrors the Claude Code Agent
 * tool: leading bot icon + "Call SubAgent" label + the description in a chip,
 * with a compact stats tail (tool count · model · tokens) that ticks up live
 * while the sub-agent runs and settles on the persisted totals when it finishes.
 * A call handed to another agent (`agentId`) also names that agent.
 */
export const CallSubAgentInspector = memo<
  BuiltinInspectorProps<CallSubAgentParams, CallSubAgentState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const theme = useTheme();

  const description = (args?.description || partialArgs?.description)?.trim();
  const targetAgentId = (args?.agentId || partialArgs?.agentId)?.trim() || undefined;
  const targetMeta = useAgentStore((s) =>
    targetAgentId ? agentSelectors.getAgentMetaById(targetAgentId)(s) : undefined,
  );
  // A background call finishes its tool step at once, so `isLoading` drops
  // while the sub-agent is still working.
  const runningInBackground = pluginState?.background === true && pluginState.status === 'pending';
  const isShiny = isArgumentsStreaming || isLoading || runningInBackground;

  // The completion bridge writes the authoritative stats flat onto pluginState at
  // the end of the run; until then `progress` holds the live totals streamed off
  // the running sub-agent. Prefer the flat ones so the tail never regresses to a
  // stale live sample once the run is done.
  const hasFinalStats =
    pluginState?.totalTokens !== undefined || pluginState?.totalToolCalls !== undefined;
  const stats = hasFinalStats ? pluginState : pluginState?.progress;

  return (
    <div className={cx(inspectorTextStyles.root, styles.root)}>
      <GroupBotIcon className={styles.icon} size={14} />
      <span className={cx(styles.label, isShiny && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent.apiName.callSubAgent')}
      </span>
      {targetAgentId && targetMeta && (
        <AgentAvatar
          agentId={targetAgentId}
          avatar={targetMeta.avatar}
          background={targetMeta.backgroundColor || theme.colorBgContainer}
          shape={'square'}
          size={18}
          title={targetMeta.title || undefined}
        />
      )}
      {targetAgentId && <span className={styles.label}>{targetMeta?.title || targetAgentId}</span>}
      {description && <span className={styles.chip}>{description}</span>}
      {runningInBackground && (
        <span className={styles.background}>
          {t('builtins.lobe-agent.subAgent.backgroundRunning')}
        </span>
      )}
      {stats && (
        <SubAgentStats
          model={stats.model}
          totalTokens={stats.totalTokens}
          totalToolCalls={stats.totalToolCalls}
        />
      )}
    </div>
  );
});

CallSubAgentInspector.displayName = 'CallSubAgentInspector';

export default CallSubAgentInspector;
