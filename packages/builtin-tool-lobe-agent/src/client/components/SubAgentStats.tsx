'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SubAgentRunStats } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    flex-shrink: 0;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const formatTokens = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
};

/**
 * Compact one-line sub-agent run stats: tool count · model · token count.
 * Renders nothing when no stat is available (e.g. while the run is still in
 * flight, before the tool result state is persisted).
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

  return <span className={styles.root}>{items.join(' · ')}</span>;
});

SubAgentStats.displayName = 'SubAgentStats';

export default SubAgentStats;
