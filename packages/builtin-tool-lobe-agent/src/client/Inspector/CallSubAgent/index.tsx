'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { GroupBotIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CallSubAgentParams, CallSubAgentState } from '../../../types';
import { SubAgentStats } from '../../components/SubAgentStats';

const styles = stylex.create({
  background: { flexShrink: 0, fontSize: '12px', color: cssVar.colorTextDescription },
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  icon: { flexShrink: 0, color: cssVar.colorTextDescription },
  label: { flexShrink: 0 },
  labelColor: { color: cssVar.colorText },
  root: { gap: '6px' },
});

/**
 * Collapsed row for lobe-agent's `callSubAgent`. Mirrors the Claude Code Agent
 * tool: leading bot icon + "Call SubAgent" label + the description in a chip,
 * with a compact stats tail (tool count · model · tokens) that ticks up live
 * while the sub-agent runs and settles on the persisted totals when it finishes.
 */
export const CallSubAgentInspector = memo<
  BuiltinInspectorProps<CallSubAgentParams, CallSubAgentState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const description = (args?.description || partialArgs?.description)?.trim();
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
    <div className={cx(inspectorTextStyles.root, stylex.props(styles.root).className)}>
      <GroupBotIcon className={stylex.props(styles.icon).className} size={14} />
      <span
        className={cx(
          stylex.props(styles.label, !isShiny && styles.labelColor).className,
          isShiny && shinyTextStyles.shinyText,
        )}
      >
        {t('builtins.lobe-agent.apiName.callSubAgent')}
      </span>
      {description && <span {...stylex.props(styles.chip)}>{description}</span>}
      {runningInBackground && (
        <span {...stylex.props(styles.background)}>
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
