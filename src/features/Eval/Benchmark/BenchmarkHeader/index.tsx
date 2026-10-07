'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button, confirmModal, DropdownMenu, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Ellipsis, Pencil, Plus, Trash2, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { createBenchmarkEditModal } from '@/features/Eval/BenchmarkEditModal';
import { EvalPageHeader } from '@/features/Eval/components/EvalPage';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';

import { getBenchmarkIcon } from '../benchmarkIcon';
import { createRunCreateModal } from '../RunCreateModal';

const styles = createStaticStyles(({ css }) => ({
  crumb: css`
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  icon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  meta: css`
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface BenchmarkHeaderProps {
  benchmark: any;
  caseCount: number;
  datasetCount: number;
  /** Add-dataset flow, offered as the primary action until there is something to run. */
  onAddDataset: () => void;
  onUpdated?: () => void;
  runCount: number;
}

const BenchmarkHeader = ({
  benchmark,
  caseCount,
  datasetCount,
  onAddDataset,
  onUpdated,
  runCount,
}: BenchmarkHeaderProps) => {
  const { t } = useTranslation('eval');
  const { t: tc } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const deleteBenchmark = useEvalStore((s) => s.deleteBenchmark);
  const refreshBenchmarkDetail = useEvalStore((s) => s.refreshBenchmarkDetail);

  const handleEdit = () =>
    createBenchmarkEditModal({
      benchmark,
      onSuccess: async () => {
        await refreshBenchmarkDetail(benchmark.id);
        onUpdated?.();
      },
    });

  const handleDelete = () =>
    confirmModal({
      content: t('benchmark.actions.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('benchmark.actions.delete'),
      onOk: async () => {
        await deleteBenchmark(benchmark.id);
        navigate('/eval');
      },
      title: t('benchmark.actions.delete'),
    });

  const tags: string[] = benchmark.tags ?? [];
  const hasData = datasetCount > 0;

  return (
    <EvalPageHeader
      description={benchmark.description}
      title={benchmark.name}
      actions={
        <>
          <ActionIcon icon={Pencil} title={t('benchmark.actions.edit')} onClick={handleEdit} />
          <DropdownMenu
            placement="bottomRight"
            items={[
              {
                danger: true,
                icon: <Trash2 size={14} />,
                key: 'delete',
                label: t('benchmark.actions.delete'),
                onClick: handleDelete,
              },
            ]}
          >
            <ActionIcon icon={Ellipsis} title={t('benchmark.runs.more')} />
          </DropdownMenu>
          {hasData ? (
            <Button
              icon={Plus}
              type="primary"
              onClick={() => createRunCreateModal({ benchmarkId: benchmark.id })}
            >
              {t('run.actions.create')}
            </Button>
          ) : (
            <Button icon={Plus} type="primary" onClick={onAddDataset}>
              {t('dataset.actions.addDataset')}
            </Button>
          )}
        </>
      }
      breadcrumb={
        <WorkspaceLink className={styles.crumb} to="/eval">
          {tc('tab.eval')}
        </WorkspaceLink>
      }
      icon={
        <div className={styles.icon}>
          <Icon
            icon={benchmark.source === 'user' ? User : getBenchmarkIcon(benchmark.id)}
            size={20}
          />
        </div>
      }
      meta={
        <Flexbox horizontal align="center" className={styles.meta} gap={8} wrap="wrap">
          <span>
            {[
              t('benchmark.card.datasetCount', { count: datasetCount }),
              t('benchmark.card.caseCount', { count: caseCount }),
              t('benchmark.card.runCount', { count: runCount }),
            ].join(' · ')}
          </span>
          {tags.map((tag) => (
            <Tag key={tag} size="small">
              {tag}
            </Tag>
          ))}
        </Flexbox>
      }
    />
  );
};

export default BenchmarkHeader;
