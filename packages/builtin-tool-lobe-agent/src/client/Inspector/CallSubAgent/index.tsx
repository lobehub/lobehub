'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { GroupBotIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CallSubAgentParams, CallSubAgentState } from '../../../types';
import { SubAgentStats } from '../../components/SubAgentStats';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
 */
export const CallSubAgentInspector = memo<
  BuiltinInspectorProps<CallSubAgentParams, CallSubAgentState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const description = (args?.description || partialArgs?.description)?.trim();
  const isShiny = isArgumentsStreaming || isLoading;

  // The completion bridge writes the authoritative stats flat onto pluginState at
  // the end of the run; until then `progress` holds the live totals streamed off
  // the running sub-agent. Prefer the flat ones so the tail never regresses to a
  // stale live sample once the run is done.
  const hasFinalStats =
    pluginState?.totalTokens !== undefined || pluginState?.totalToolCalls !== undefined;
  const stats = hasFinalStats ? pluginState : pluginState?.progress;

  return (
    <div
      className={cx(inspectorTextStyles.root, styles.root, isShiny && shinyTextStyles.shinyText)}
    >
      <GroupBotIcon className={styles.icon} size={14} />
      <span className={styles.label}>{t('builtins.lobe-agent.apiName.callSubAgent')}</span>
      {description && <span className={styles.chip}>{description}</span>}
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
