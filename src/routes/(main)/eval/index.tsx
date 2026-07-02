'use client';

import { Button, Empty, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FlaskConical, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

import BenchmarkCard from './features/BenchmarkCard';
import { createCreateBenchmarkModal } from './features/CreateBenchmarkModal';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-y: auto;
    padding-block: 24px;
    padding-inline: 32px;
  `,
  grid: css`
    display: grid;
    gap: 20px;
    grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
  `,
  skeletonCard: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  title: css`
    margin: 0;
    line-height: 1.3;
  `,
}));

// Loading placeholder that reuses the benchmark-card chrome so loading → loaded
// is a content swap, not a relayout (ux §4.1).
const SkeletonGrid = memo(() => (
  <div className={styles.grid}>
    {[0, 1, 2, 3].map((i) => (
      <Flexbox className={styles.skeletonCard} gap={16} key={i}>
        <Flexbox horizontal gap={12}>
          <Skeleton.Avatar active shape={'square'} size={36} />
          <Flexbox flex={1} gap={8}>
            <Skeleton.Button active size={'small'} style={{ height: 14, width: 160 }} />
            <Skeleton.Button active size={'small'} style={{ height: 12, width: 220 }} />
          </Flexbox>
        </Flexbox>
        <Skeleton.Button active block size={'small'} style={{ height: 64 }} />
      </Flexbox>
    ))}
  </div>
));

const EvalOverview = memo(() => {
  const { t } = useTranslation('eval');
  const benchmarkList = useEvalStore((s) => s.benchmarkList);
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  const { isLoading } = useFetchBenchmarks();

  return (
    <Flexbox className={styles.container} gap={32} height={'100%'} width={'100%'}>
      {/* Header */}
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Flexbox gap={4} style={{ minWidth: 0 }}>
          <Text as={'h1'} className={styles.title} ellipsis fontSize={30} weight={600}>
            {t('overview.title')}
          </Text>
          <Text type={'secondary'}>{t('overview.subtitle')}</Text>
        </Flexbox>
        {benchmarkList.length > 0 && (
          <Button icon={Plus} type={'primary'} onClick={() => createCreateBenchmarkModal()}>
            {t('overview.createBenchmark')}
          </Button>
        )}
      </Flexbox>

      {/* Body: loading / empty / grid */}
      {isLoading ? (
        <SkeletonGrid />
      ) : benchmarkList.length === 0 ? (
        <Flexbox align={'center'} flex={1} justify={'center'}>
          <Empty description={t('benchmark.empty')} icon={FlaskConical}>
            <Button
              icon={Plus}
              style={{ marginTop: 16 }}
              type={'primary'}
              onClick={() => createCreateBenchmarkModal()}
            >
              {t('overview.createBenchmark')}
            </Button>
          </Empty>
        </Flexbox>
      ) : (
        <div className={styles.grid}>
          {benchmarkList.map((benchmark: any) => (
            <BenchmarkCard
              bestScore={benchmark.bestScore}
              datasetCount={benchmark.datasetCount}
              description={benchmark.description}
              id={benchmark.id}
              key={benchmark.id}
              name={benchmark.name}
              recentRuns={benchmark.recentRuns}
              runCount={benchmark.runCount}
              source={benchmark.source}
              tags={benchmark.tags}
              testCaseCount={benchmark.testCaseCount}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

export default EvalOverview;
