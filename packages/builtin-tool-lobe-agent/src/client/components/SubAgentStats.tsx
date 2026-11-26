'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SubAgentRunStats } from '../../types';

const styles = stylex.create({
  root: {
    overflow: 'hidden',
    flexShrink: 0,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const formatTokens = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
};

/**
 * Compact one-line sub-agent run stats: tool count · model · token count.
 * Fed live during the run (streamed totals) and by the persisted state after it,
 * so the same row serves both. Renders nothing until the first stat arrives.
 */
export const SubAgentStats = memo<SubAgentRunStats>(({ model, totalToolCalls, totalTokens }) => {
  const { t } = useTranslation('plugin');

  const items = [
    model || null,
    typeof totalToolCalls === 'number' && totalToolCalls > 0
      ? t('builtins.lobe-agent.subAgent.stats.tools', { count: totalToolCalls })
      : null,
    typeof totalTokens === 'number' && totalTokens > 0
      ? t('builtins.lobe-agent.subAgent.stats.tokens', { count: formatTokens(totalTokens) })
      : null,
  ].filter(Boolean);

  if (items.length === 0) return null;

  return <span {...stylex.props(styles.root)}>{items.join(' · ')}</span>;
});

SubAgentStats.displayName = 'SubAgentStats';

export default SubAgentStats;
