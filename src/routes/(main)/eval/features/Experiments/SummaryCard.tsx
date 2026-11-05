'use client';

import type { AgentEvalExperimentListItem } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, Beaker } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import RunRow from './RunRow';

const styles = stylex.create({
  card: {
    height: '100%',
    padding: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: {
      'default': 'border-color 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  detailLink: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: cssVar.borderRadiusSM,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  iconBox: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorInfo,
    backgroundColor: cssVar.colorInfoBg,
    backgroundImage: 'none',
  },
  name: {
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorPrimary },
  },
});

interface SummaryCardProps {
  experiment: AgentEvalExperimentListItem;
}

/** Home overview card for an experiment: identity + counts + recent-runs preview. */
const SummaryCard = memo<SummaryCardProps>(({ experiment }) => {
  const { t } = useTranslation('eval');
  const recentRuns = experiment.recentRuns?.slice(0, 3) || [];
  const fallbackBenchmarkId = experiment.benchmarks[0]?.id || '';

  return (
    <Flexbox className={stylex.props(styles.card).className} gap={16}>
      <Flexbox horizontal align="flex-start" gap={12} justify="space-between">
        <Flexbox horizontal align="center" gap={12} style={{ minWidth: 0 }}>
          <div {...stylex.props(styles.iconBox)}>
            <Icon icon={Beaker} size={22} />
          </div>
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <WorkspaceLink
              className={stylex.props(styles.name).className}
              to={`/eval/experiments/${experiment.id}`}
            >
              {experiment.name}
            </WorkspaceLink>
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {t('experiment.card.benchmarkCount', { count: experiment.benchmarkCount })}
              {' · '}
              {t('experiment.card.runCount', { count: experiment.runCount })}
            </Text>
          </Flexbox>
        </Flexbox>
        <WorkspaceLink
          className={stylex.props(styles.detailLink).className}
          to={`/eval/experiments/${experiment.id}`}
        >
          <Icon icon={ArrowRight} size={16} />
        </WorkspaceLink>
      </Flexbox>

      {recentRuns.length > 0 && (
        <Flexbox gap={0}>
          {recentRuns.map((run) => (
            <RunRow benchmarkId={run.benchmarkId || fallbackBenchmarkId} key={run.id} run={run} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default SummaryCard;
