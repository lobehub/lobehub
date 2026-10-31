import {
  ActionIcon,
  Block,
  Button,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Spin,
  Tag,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, ChevronRight, Database, Ellipsis, Pencil, Play, Trash2 } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';

import { DATASET_PRESETS } from '../../../../config/datasetPresets';
import TestCaseEmptyState from './TestCaseEmptyState';
import TestCaseTable from './TestCaseTable';

const styles = stylex.create({
  card: { borderRadius: cssVar.borderRadiusLG },
  caseCount: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: '2px',
    alignItems: 'flex-end',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  caseCountLabel: { fontSize: cssVar.fontSizeSM, lineHeight: 1, color: cssVar.colorTextTertiary },
  caseCountValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorText,
  },
  chevron: {
    flexShrink: 0,
    color: cssVar.colorTextTertiary,
    transition: {
      'default': 'transform 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  datasetDescription: {
    overflow: 'hidden',
    margin: '0',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  datasetHeader: {
    cursor: 'pointer',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    width: '100%',
    padding: '16px',
    borderStyle: 'none',
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: {
      'default': 'background 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-1px' },
  },
  datasetIcon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorPrimaryBg,
    backgroundImage: 'none',
  },
  datasetName: { margin: '0', fontSize: cssVar.fontSize, fontWeight: 500, color: cssVar.colorText },
  expandedSection: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  footer: {
    padding: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  footerLink: { textDecoration: 'none' },
});

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
    const deleteDataset = useEvalStore((s) => s.deleteDataset);

    const handleDelete = useCallback(() => {
      confirmModal({
        content: t('dataset.delete.confirm'),
        okButtonProps: { danger: true },
        okText: t('common.delete'),
        onOk: async () => {
          try {
            await deleteDataset(dataset.id);
            toast.success(t('dataset.delete.success'));
            onRefresh();
          } catch {
            toast.error(t('dataset.delete.error'));
          }
        },
        title: t('common.delete'),
      });
    }, [dataset.id, deleteDataset, onRefresh, t]);

    return (
      <Block className={stylex.props(styles.card).className} variant={'outlined'}>
        <div
          {...stylex.props(styles.datasetHeader)}
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
          <div {...stylex.props(styles.datasetIcon)}>
            <Database size={16} style={{ color: cssVar.colorPrimary }} />
          </div>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <p {...stylex.props(styles.datasetName)}>{dataset.name}</p>
              {dataset.metadata?.preset && DATASET_PRESETS[dataset.metadata.preset] && (
                <Tag size="small">{DATASET_PRESETS[dataset.metadata.preset].name}</Tag>
              )}
            </Flexbox>
            {dataset.description && (
              <p {...stylex.props(styles.datasetDescription)}>{dataset.description}</p>
            )}
          </Flexbox>
          <div {...stylex.props(styles.caseCount)}>
            <span {...stylex.props(styles.caseCountValue)}>{dataset.testCaseCount || 0}</span>
            <span {...stylex.props(styles.caseCountLabel)}>
              {t('benchmark.detail.stats.cases')}
            </span>
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
            className={stylex.props(styles.chevron).className}
            size={16}
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        </div>

        {isExpanded && (
          <div {...stylex.props(styles.expandedSection)}>
            {loading ? (
              <Flexbox align="center" justify="center" style={{ padding: '48px 24px' }}>
                <Spin size="large" />
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
            <Flexbox
              horizontal
              align="center"
              className={stylex.props(styles.footer).className}
              justify="center"
            >
              <WorkspaceLink
                className={stylex.props(styles.footerLink).className}
                to={`/eval/bench/${benchmarkId}/datasets/${dataset.id}`}
              >
                <Button icon={ArrowRight} iconPosition="end" size="small" type="text">
                  {t('dataset.detail.viewDetail')}
                </Button>
              </WorkspaceLink>
            </Flexbox>
          </div>
        )}
      </Block>
    );
  },
);

export default DatasetCard;
