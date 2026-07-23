'use client';

import type { AgentEvalDatasetListItem } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, Database, Play } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = createStaticStyles(({ css }) => ({
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  row: css`
    padding-block: 10px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadius};
    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

interface DatasetRowProps {
  dataset: AgentEvalDatasetListItem;
  onAddRun: (dataset: AgentEvalDatasetListItem) => void;
}

/**
 * Compact dataset row for the experiment workspace: identity + test-case
 * count, an "Add Run" action, and a chevron to the full dataset detail page.
 */
const DatasetRow = memo<DatasetRowProps>(({ dataset, onAddRun }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox horizontal align="center" className={styles.row} gap={12}>
      <div className={styles.iconBox}>
        <Icon icon={Database} size={16} />
      </div>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis weight={500}>
          {dataset.name}
        </Text>
        {typeof dataset.testCaseCount === 'number' && (
          <Text fontSize={12} type="secondary">
            {t('run.create.caseCount', { count: dataset.testCaseCount })}
          </Text>
        )}
      </Flexbox>

      <Button icon={Play} size={'small'} type={'text'} onClick={() => onAddRun(dataset)}>
        {t('dataset.detail.addRun')}
      </Button>
      <WorkspaceLink to={`/eval/bench/${dataset.benchmarkId}/datasets/${dataset.id}`}>
        <ActionIcon icon={ChevronRight} size={'small'} />
      </WorkspaceLink>
    </Flexbox>
  );
});

export default DatasetRow;
