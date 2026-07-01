'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Play, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { runSelectors, useEvalStore } from '@/store/eval';

import RunSummaryCard from './RunSummaryCard';

const styles = createStaticStyles(({ css }) => ({
  emptyCard: css`
    align-items: center;
    justify-content: center;

    padding-block: 32px;
    padding-inline: 20px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    text-align: center;

    background: ${cssVar.colorFillQuaternary};
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface RunCardsProps {
  benchmarkId: string;
  datasetId?: string;
  onCreateRun: () => void;
}

const RunCards = memo<RunCardsProps>(({ datasetId, onCreateRun, benchmarkId }) => {
  const { t } = useTranslation('eval');
  const useFetchDatasetRuns = useEvalStore((s) => s.useFetchDatasetRuns);
  const runList = useEvalStore(runSelectors.datasetRunList(datasetId!));
  useFetchDatasetRuns(datasetId);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" justify="space-between">
        <Text weight={600}>{t('benchmark.detail.tabs.runs')}</Text>
        <ActionIcon
          icon={Plus}
          size="small"
          title={t('run.actions.create')}
          onClick={onCreateRun}
        />
      </Flexbox>
      {runList.length === 0 ? (
        <Flexbox className={styles.emptyCard} gap={12}>
          <div className={styles.iconBox}>
            <Icon icon={Play} size={20} style={{ color: cssVar.colorTextQuaternary }} />
          </div>
          <Flexbox align="center" gap={2}>
            <Text color={cssVar.colorTextTertiary}>{t('run.empty.title')}</Text>
            <Text color={cssVar.colorTextQuaternary} fontSize={12}>
              {t('run.empty.description')}
            </Text>
          </Flexbox>
          <Button icon={<Plus size={14} />} size="small" type="primary" onClick={onCreateRun}>
            {t('run.actions.create')}
          </Button>
        </Flexbox>
      ) : (
        <Flexbox gap={8}>
          {runList.map((run) => (
            <RunSummaryCard
              benchmarkId={benchmarkId}
              id={run.id}
              key={run.id}
              metrics={run.metrics ?? undefined}
              name={run.name ?? undefined}
              status={run.status}
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default RunCards;
