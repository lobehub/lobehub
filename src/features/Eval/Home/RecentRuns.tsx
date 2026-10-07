'use client';

import type { AgentEvalRunListItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';

import RecentRunRow, { styles as rowStyles } from './RecentRunRow';
import { getRunHref } from './runHelpers';

const VISIBLE_RUNS = 6;

const styles = createStaticStyles(({ css }) => ({
  head: css`
    padding-block: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    &:hover {
      background: transparent;
    }
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  end: css`
    text-align: end;
  `,
}));

const RecentRunsSkeleton = () => (
  <div className={styles.list}>
    {[0, 1, 2].map((i) => (
      <div className={rowStyles.row} key={i}>
        <Flexbox horizontal align="center" gap={12}>
          <Skeleton.Avatar shape="square" size={28} />
          <Flexbox flex={1} gap={6}>
            <Skeleton height={14} width="60%" />
            <Skeleton height={12} width="40%" />
          </Flexbox>
        </Flexbox>
        <span data-col="models">
          <Skeleton height={14} width="70%" />
        </span>
        <Skeleton height={14} width={40} />
        <Skeleton height={14} width={72} />
        <span data-col="time">
          <Skeleton height={12} width={64} />
        </span>
      </div>
    ))}
  </div>
);

interface RecentRunsProps {
  benchmarkIdByDataset: Map<string, string | null | undefined>;
  data: unknown;
  error?: unknown;
  isLoading?: boolean;
  onRetry: () => void;
  runs: AgentEvalRunListItem[];
}

const RecentRuns = ({
  benchmarkIdByDataset,
  data,
  error,
  isLoading,
  onRetry,
  runs,
}: RecentRunsProps) => {
  const { t } = useTranslation('eval');
  const visible = runs.slice(0, VISIBLE_RUNS);

  return (
    <EvalSection
      count={runs.length > 0 ? runs.length : undefined}
      description={t('home.recent.description')}
      title={t('home.recent.title')}
    >
      <AsyncBoundary
        data={data}
        error={error}
        isEmpty={runs.length === 0}
        isLoading={isLoading}
        loading={<RecentRunsSkeleton />}
        empty={
          <EvalEmpty
            compact
            description={t('home.recent.emptyHint')}
            icon={History}
            title={t('home.recent.empty')}
          />
        }
        onRetry={onRetry}
      >
        <div className={styles.list}>
          <div aria-hidden className={`${rowStyles.row} ${styles.head}`}>
            <span>{t('home.recent.columns.run')}</span>
            <span data-col="models">{t('home.recent.columns.models')}</span>
            <span className={styles.end}>{t('home.recent.passRate')}</span>
            <span>{t('home.recent.columns.status')}</span>
            <span className={styles.end} data-col="time">
              {t('home.recent.columns.time')}
            </span>
          </div>
          {visible.map((run) => (
            <RecentRunRow href={getRunHref(run, benchmarkIdByDataset)} key={run.id} run={run} />
          ))}
        </div>
      </AsyncBoundary>
    </EvalSection>
  );
};

export default RecentRuns;
