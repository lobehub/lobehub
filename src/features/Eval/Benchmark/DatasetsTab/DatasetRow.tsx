import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button, DropdownMenu, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Database, Ellipsis, Pencil, Play, Trash2, Upload } from 'lucide-react';
import { type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { DATASET_PRESETS } from '@/features/Eval/config/datasetPresets';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

export const datasetRowStyles = createStaticStyles(({ css }) => ({
  count: css`
    flex: none;

    min-width: 72px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: end;
  `,
  countEmpty: css`
    color: ${cssVar.colorWarning};
  `,
  description: css`
    overflow: hidden;

    margin: 0;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  icon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  name: css`
    overflow: hidden;

    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;

    color: inherit;

    transition: background 0.15s ease;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

const styles = datasetRowStyles;

interface DatasetRowProps {
  dataset: any;
  onDelete: () => void;
  onEdit: () => void;
  onImport: () => void;
  onRun: () => void;
}

const stop = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

const DatasetRow = ({ dataset, onDelete, onEdit, onImport, onRun }: DatasetRowProps) => {
  const { t } = useTranslation('eval');
  const count: number = dataset.testCaseCount || 0;
  const preset = dataset.metadata?.preset && DATASET_PRESETS[dataset.metadata.preset];

  return (
    <WorkspaceLink className={styles.row} to={`/eval/datasets/${dataset.id}`}>
      <div className={styles.icon}>
        <Icon icon={Database} size={16} />
      </div>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          <span className={styles.name}>{dataset.name}</span>
          {preset && <Tag size="small">{preset.name}</Tag>}
        </Flexbox>
        {dataset.description && <p className={styles.description}>{dataset.description}</p>}
      </Flexbox>
      <span className={count === 0 ? `${styles.count} ${styles.countEmpty}` : styles.count}>
        {count === 0 ? t('benchmark.datasets.noCases') : t('benchmark.card.caseCount', { count })}
      </span>
      <Flexbox horizontal align="center" gap={4} onClick={stop}>
        {count === 0 ? (
          <Button icon={Upload} size="small" onClick={onImport}>
            {t('dataset.actions.import')}
          </Button>
        ) : (
          <Button icon={Play} size="small" onClick={onRun}>
            {t('run.actions.run')}
          </Button>
        )}
        <DropdownMenu
          placement="bottomRight"
          items={[
            {
              icon: <Upload size={14} />,
              key: 'import',
              label: t('dataset.actions.import'),
              onClick: onImport,
            },
            {
              icon: <Pencil size={14} />,
              key: 'edit',
              label: t('common.edit'),
              onClick: onEdit,
            },
            { type: 'divider' as const },
            {
              danger: true,
              icon: <Trash2 size={14} />,
              key: 'delete',
              label: t('common.delete'),
              onClick: onDelete,
            },
          ]}
        >
          <ActionIcon icon={Ellipsis} size="small" title={t('benchmark.runs.more')} />
        </DropdownMenu>
      </Flexbox>
    </WorkspaceLink>
  );
};

export default DatasetRow;
