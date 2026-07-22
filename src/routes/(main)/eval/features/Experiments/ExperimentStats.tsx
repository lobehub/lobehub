'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  statDivider: css`
    width: 1px;
    height: 28px;
    background: ${cssVar.colorBorderSecondary};
  `,
  statValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

// One labeled figure in the strip (big mono number over a quiet label) — the
// same pattern as BenchmarkCard's stat strip.
const Stat = memo<{ label: string; value: number | string }>(({ value, label }) => (
  <Flexbox gap={2}>
    <Text className={styles.statValue} fontSize={20}>
      {value}
    </Text>
    <Text color={cssVar.colorTextTertiary} fontSize={12}>
      {label}
    </Text>
  </Flexbox>
));

interface ExperimentStatsProps {
  datasetCount: number;
  experiment: AgentEvalExperimentDetail;
}

const ExperimentStats = memo<ExperimentStatsProps>(({ experiment, datasetCount }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox horizontal align="center" gap={24}>
      <Stat label={t('experiment.detail.stats.benchmarks')} value={experiment.benchmarks.length} />
      <span className={styles.statDivider} />
      <Stat label={t('sidebar.datasets')} value={datasetCount} />
      <span className={styles.statDivider} />
      <Stat label={t('experiment.detail.stats.runs')} value={experiment.runs.length} />
    </Flexbox>
  );
});

export default ExperimentStats;
