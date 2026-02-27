import { Button, Flexbox, Tag } from '@lobehub/ui';
import { App, Card, Dropdown } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ArrowRight, ChevronRight, Database, Ellipsis, Pencil, Play, Trash2 } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { agentEvalService } from '@/services/agentEval';

import { DATASET_PRESETS } from '../../../../config/datasetPresets';
import TestCaseEmptyState from './TestCaseEmptyState';
import TestCaseTable from './TestCaseTable';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    .ant-card-body {
      padding: 0;
    }
  `,
  caseCount: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  datasetDescription: css`
    overflow: hidden;

    margin: 0;

    font-size: 12px;
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

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  datasetIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: 8px;

    background: ${cssVar.colorPrimaryBg};
  `,
  datasetName: css`
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  dropdownButton: css`
    width: 28px;
    height: 28px;
    padding: 0;
    color: ${cssVar.colorTextTertiary};
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
    const { modal, message } = App.useApp();

    const handleDelete = useCallback(() => {
      modal.confirm({
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
    }, [dataset.id, message, modal, onRefresh, t]);

    return (
      <Card className={styles.card}>
        <div className={styles.datasetHeader} onClick={onExpand}>
          <div className={styles.datasetIcon}>
            <Database size={16} style={{ color: 'var(--ant-color-primary)' }} />
          </div>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <p className={styles.datasetName}>{dataset.name}</p>
              {dataset.metadata?.preset && DATASET_PRESETS[dataset.metadata.preset] && (
                <Tag style={{ fontSize: 10 }}>{DATASET_PRESETS[dataset.metadata.preset].name}</Tag>
              )}
            </Flexbox>
            {dataset.description && (
              <p className={styles.datasetDescription}>{dataset.description}</p>
            )}
          </Flexbox>
          <span className={styles.caseCount}>
            {dataset.testCaseCount || 0} {t('benchmark.detail.stats.cases').toLowerCase()}
          </span>
          <Button
            icon={Play}
            size="small"
            style={{
              height: 28,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onRun();
            }}
          >
            {t('run.actions.run')}
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  icon: <Pencil size={14} />,
                  key: 'edit',
                  label: t('common.edit'),
                  onClick: () => onEdit(dataset),
                },
                { type: 'divider' },
                {
                  danger: true,
                  icon: <Trash2 size={14} />,
                  key: 'delete',
                  label: t('common.delete'),
                  onClick: handleDelete,
                },
              ],
            }}
          >
            <Button
              className={styles.dropdownButton}
              icon={Ellipsis}
              size="small"
              variant="text"
              onClick={(e) => e.stopPropagation()}
            />
          </Dropdown>
          <ChevronRight
            size={16}
            style={{
              color: 'var(--ant-color-text-tertiary)',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
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
              <Link
                className={styles.footerLink}
                to={`/eval/bench/${benchmarkId}/datasets/${dataset.id}`}
              >
                <Button icon={ArrowRight} iconPosition="end" size="small" variant="text">
                  {t('dataset.detail.viewDetail')}
                </Button>
              </Link>
            </Flexbox>
          </div>
        )}
      </Card>
    );
  },
);

export default DatasetCard;
