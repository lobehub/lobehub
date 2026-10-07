'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { createRunCreateModal } from '@/features/Eval/Benchmark/RunCreateModal';
import RunCard from '@/features/Eval/Benchmark/RunsTab/RunCard';
import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';

interface RunsSectionProps {
  benchmarkId: string;
  datasetId: string;
  datasetName: string;
  runs: any[];
}

/**
 * Agent runs scored against the benchmark this dataset belongs to. Only shown
 * for benchmark datasets — a run needs the benchmark's rubrics.
 */
const RunsSection = ({ benchmarkId, datasetId, datasetName, runs }: RunsSectionProps) => {
  const { t } = useTranslation('eval');
  const openCreate = () => createRunCreateModal({ benchmarkId, datasetId, datasetName });

  return (
    <EvalSection
      count={runs.length}
      title={t('dataset.runs.title')}
      actions={
        runs.length > 0 && (
          <Button icon={Plus} size="small" onClick={openCreate}>
            {t('dataset.detail.addRun')}
          </Button>
        )
      }
    >
      {runs.length > 0 ? (
        <Flexbox gap={12}>
          {runs.map((run) => (
            <RunCard benchmarkId={benchmarkId} key={run.id} run={run} />
          ))}
        </Flexbox>
      ) : (
        <EvalEmpty
          compact
          description={t('dataset.runs.emptyHint')}
          icon={Play}
          title={t('dataset.runs.empty')}
          action={
            <Button icon={Plus} size="small" onClick={openCreate}>
              {t('dataset.detail.addRun')}
            </Button>
          }
        />
      )}
    </EvalSection>
  );
};

export default RunsSection;
