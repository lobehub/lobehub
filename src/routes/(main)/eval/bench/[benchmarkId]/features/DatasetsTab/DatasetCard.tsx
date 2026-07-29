import { ActionIcon, DropdownMenu, Flexbox, Tag } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { App, Card } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRight, ChevronRight, Database, Ellipsis, Pencil, Play, Trash2 } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { agentEvalService } from '@/services/agentEval';

import { DATASET_PRESETS } from '../../../../config/datasetPresets';
import TestCaseEmptyState from './TestCaseEmptyState';
import TestCaseTable from './TestCaseTable';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    .ant-card-body {
      padding: 0;
    }
  `,
  // Tonal figure block that leads with the dataset's headline metric — its
  // test-case count — given mono weight so it reads as a result at a glance.
  caseCount: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 2px;
    align-items: flex-end;

    padding-block: 6px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  caseCountLabel: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  caseCountValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
    transition: transform 0.15s ease;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  datasetDescription: css`
    overflow: hidden;

    margin: 0;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  datasetHeader: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    width: 100%;
    padding: 16px;
    border: none;

    text-align: start;

    background: transparent;

    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  datasetIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorPrimaryBg};
  `,
  datasetName: css`
    margin: 0;
    font-size: ${cssVar.fontSize};
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  expandedSection: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  footer: css`
    padding: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  footerLink: css`
    text-decoration: none;
  `,
}));

interface DatasetCardProps {
  benchmarkId: string;
  dataset: any;
  diffFilter: 'all' | 'easy' | 'medium' | 'hard';
  filteredCases: any[];
  isExpanded: boolean;
  loading: boolean;
  onAddCase: () => void;
  onDeleteCase: (testCase: any) => void;
  onDiffFilterChange: (filter: 'all' | 'easy' | 'medium' | 'hard') => void;
  onEdit: (dataset: any) => void;
  onExpand: () => void;
  onImport: () => void;
  onPageChange: (page: number, pageSize: number) => void;
  onRefresh: () => void;
  onRun: () => void;
  onSearchChange: (value: string) => void;
  pagination: { current: number; pageSize: number };
  search: string;
  total: number;
}

const DatasetCard = memo<DatasetCardProps>(
  ({
    benchmarkId,
    dataset,
    isExpanded,
    loading,
    total,
    filteredCases,
    search,
    diffFilter,
    pagination,
    onExpand,
    onEdit,
    onDeleteCase,
    onRefresh,
    onSearchChange,
    onDiffFilterChange,
    onPageChange,
    onAddCase,
    onImport,
    onRun,
  }) => {
    const { t } = useTranslation('eval');
    const { message } = App.useApp();

    const handleDelete = useCallback(() => {
      confirmModal({
        content: t('dataset.delete.confirm'),
        okButtonProps: { danger: true },
        okText: t('common.delete'),
        onOk: async () => {
          try {
            await agentEvalService.deleteDataset(dataset.id);
            message.success(t('dataset.delete.success'));
            onRefresh();
          } catch {
            message.error(t('dataset.delete.error'));
          }
        },
        title: t('common.delete'),
      });
    }, [dataset.id, message, onRefresh, t]);

    return (
      <Card className={styles.card}>
        <div
          className={styles.datasetHeader}
          role="button"
          tabIndex={0}
          onClick={onExpand}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onExpand();
            }
          }}
        >
          <div className={styles.datasetIcon}>
            <Database size={16} style={{ color: cssVar.colorPrimary }} />
          </div>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <p className={styles.datasetName}>{dataset.name}</p>
              {dataset.metadata?.preset && DATASET_PRESETS[dataset.metadata.preset] && (
                <Tag size="small">{DATASET_PRESETS[dataset.metadata.preset].name}</Tag>
              )}
            </Flexbox>
            {dataset.description && (
              <p className={styles.datasetDescription}>{dataset.description}</p>
            )}
          </Flexbox>
          <div className={styles.caseCount}>
            <span className={styles.caseCountValue}>{dataset.testCaseCount || 0}</span>
            <span className={styles.caseCountLabel}>{t('benchmark.detail.stats.cases')}</span>
          </div>
          <Button
            icon={Play}
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onRun();
            }}
          >
            {t('run.actions.run')}
          </Button>
          <DropdownMenu
            trigger={['click']}
            items={[
              {
                icon: <Pencil size={14} />,
                key: 'edit',
                label: t('common.edit'),
                onClick: () => onEdit(dataset),
              },
              { type: 'divider' as const },
              {
                danger: true,
                icon: <Trash2 size={14} />,
                key: 'delete',
                label: t('common.delete'),
                onClick: handleDelete,
              },
            ]}
          >
            <ActionIcon icon={Ellipsis} size="small" onClick={(e) => e.stopPropagation()} />
          </DropdownMenu>
          <ChevronRight
            className={styles.chevron}
            size={16}
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        </div>

        {isExpanded && (
          <div className={styles.expandedSection}>
            {loading ? (
              <Flexbox align="center" justify="center" style={{ padding: '48px 24px' }}>
                <NeuralNetworkLoading size={48} />
              </Flexbox>
            ) : total === 0 ? (
              <TestCaseEmptyState onAddCase={onAddCase} onImport={onImport} />
            ) : (
              <TestCaseTable
                readOnly
                datasetEvalMode={dataset.evalMode}
                diffFilter={diffFilter}
                pagination={pagination}
                search={search}
                testCases={filteredCases}
                total={total}
                onDiffFilterChange={onDiffFilterChange}
                onPageChange={onPageChange}
                onSearchChange={onSearchChange}
              />
            )}
            <Flexbox horizontal align="center" className={styles.footer} justify="center">
              <WorkspaceLink
                className={styles.footerLink}
                to={`/eval/bench/${benchmarkId}/datasets/${dataset.id}`}
              >
                <Button icon={ArrowRight} iconPosition="end" size="small" type="text">
                  {t('dataset.detail.viewDetail')}
                </Button>
              </WorkspaceLink>
            </Flexbox>
          </div>
        )}
      </Card>
    );
  },
);

export default DatasetCard;
