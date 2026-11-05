'use client';

import type { AgentEvalDatasetListItem } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Database, Play } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = stylex.create({
  iconBox: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorPrimary,
    backgroundColor: cssVar.colorPrimaryBg,
    backgroundImage: 'none',
  },
  row: {
    paddingBlock: '10px',
    paddingInline: '4px',
    borderRadius: cssVar.borderRadius,
    transition: {
      'default': 'background 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

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
    <Flexbox horizontal align="center" className={stylex.props(styles.row).className} gap={12}>
      <div {...stylex.props(styles.iconBox)}>
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
