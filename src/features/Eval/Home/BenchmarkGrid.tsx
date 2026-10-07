'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';

import BenchmarkCard from '@/features/Eval/BenchmarkCard';

export const gridStyles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  `,
  skeletonCard: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

/** Shaped like `BenchmarkCard` so loading → loaded is a content swap, not a relayout. */
export const BenchmarkGridSkeleton = ({ count = 2 }: { count?: number }) => (
  <div className={gridStyles.grid}>
    {Array.from({ length: count }, (_, i) => (
      <Flexbox className={gridStyles.skeletonCard} gap={16} key={i}>
        <Flexbox horizontal gap={12}>
          <Skeleton.Avatar shape="square" size={40} />
          <Flexbox flex={1} gap={8}>
            <Skeleton height={14} width="50%" />
            <Skeleton height={12} width="70%" />
          </Flexbox>
        </Flexbox>
        <Skeleton height={64} />
        <Skeleton height={32} width="60%" />
      </Flexbox>
    ))}
  </div>
);

const BenchmarkGrid = ({ benchmarks }: { benchmarks: any[] }) => (
  <div className={gridStyles.grid}>
    {benchmarks.map((benchmark) => (
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
);

export default BenchmarkGrid;
