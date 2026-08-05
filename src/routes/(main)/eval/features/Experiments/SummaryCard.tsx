'use client';

import type { AgentEvalExperimentListItem } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRight, Beaker } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import RunRow from './RunRow';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    height: 100%;
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: border-color 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  detailLink: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorInfo};

    background: ${cssVar.colorInfoBg};
  `,
  name: css`
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

interface SummaryCardProps {
  experiment: AgentEvalExperimentListItem;
}

/** Home overview card for an experiment: identity + counts + recent-runs preview. */
const SummaryCard = memo<SummaryCardProps>(({ experiment }) => {
  const { t } = useTranslation('eval');
  const recentRuns = experiment.recentRuns?.slice(0, 3) || [];
  const fallbackBenchmarkId = experiment.benchmarks[0]?.id || '';

  return (
    <Flexbox className={styles.card} gap={16}>
      <Flexbox horizontal align="flex-start" gap={12} justify="space-between">
        <Flexbox horizontal align="center" gap={12} style={{ minWidth: 0 }}>
          <div className={styles.iconBox}>
            <Icon icon={Beaker} size={22} />
          </div>
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <WorkspaceLink className={styles.name} to={`/eval/experiments/${experiment.id}`}>
              {experiment.name}
            </WorkspaceLink>
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {t('experiment.card.benchmarkCount', { count: experiment.benchmarkCount })}
              {' · '}
              {t('experiment.card.runCount', { count: experiment.runCount })}
            </Text>
          </Flexbox>
        </Flexbox>
        <WorkspaceLink className={styles.detailLink} to={`/eval/experiments/${experiment.id}`}>
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
