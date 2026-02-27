'use client';

import { Button, Empty, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FlaskConical, Plus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useEvalStore } from '@/store/eval';

import BenchmarkCard from './features/BenchmarkCard';
import CreateBenchmarkModal from './features/CreateBenchmarkModal';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow-y: auto;
    padding: 24px 32px;
  `,
  subtitle: css`
    margin: 0;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    line-height: 1.3;
    color: ${cssVar.colorText};
    letter-spacing: -0.02em;
  `,
}));

const EvalOverview = memo(() => {
  const { t } = useTranslation('eval');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const benchmarkList = useEvalStore((s) => s.benchmarkList);
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  const { isLoading } = useFetchBenchmarks();

  return (
    <Flexbox className={styles.container} gap={32} height="100%" width="100%">
      {/* Header */}
      <Flexbox align="center" horizontal justify="space-between">
        <Flexbox gap={4}>
          <h1 className={styles.title}>{t('overview.title')}</h1>
          <p className={styles.subtitle}>{t('overview.subtitle')}</p>
        </Flexbox>
        {benchmarkList.length > 0 && (
          <Button icon={Plus} onClick={() => setCreateModalOpen(true)} type="primary">
            {t('overview.createBenchmark')}
          </Button>
        )}
      </Flexbox>

      {/* Benchmark cards grid */}
      {isLoading ? (
        <Flexbox align="center" flex={1} justify="center">
          <NeuralNetworkLoading size={64} />
        </Flexbox>
      ) : benchmarkList.length === 0 ? (
        <Flexbox align="center" flex={1} justify="center">
          <Empty description={t('benchmark.empty')} icon={FlaskConical}>
            <Button
              icon={Plus}
              onClick={() => setCreateModalOpen(true)}
              style={{ marginTop: 16 }}
              type="primary"
            >
              {t('overview.createBenchmark')}
            </Button>
          </Empty>
        </Flexbox>
      ) : (
        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))' }}>
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

      <CreateBenchmarkModal
        onCancel={() => setCreateModalOpen(false)}
        open={createModalOpen}
      />
    </Flexbox>
  );
});

export default EvalOverview;
