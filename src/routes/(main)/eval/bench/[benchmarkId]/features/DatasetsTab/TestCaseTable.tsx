import { DropdownMenu, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Input, Pagination, Table, type TableColumn, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Ellipsis, ExternalLink, FileUp, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import SegmentBar from '../../../../features/SegmentBar';
import moduleStyles from './TestCaseTable.module.css';

const styles = stylex.create({
  filterButton: {
    cursor: 'pointer',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderInlineEndWidth: 0,
    borderInlineStartWidth: { 'default': 0, ':not(:first-child)': '1px' },
    borderStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    textTransform: 'capitalize',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: {
      'default': 'color 0.15s ease, background 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-1px' },
  },
  filterButtonActive: {
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillSecondary,
  },
  filterButtonInactive: {
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
  },
  filterContainer: {
    overflow: 'hidden',
    display: 'flex',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusSM,
  },
  filtersRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  // Summary strip — leads the table with the case total as a mono figure plus a
  // proportional read of the difficulty mix across the loaded cases.
  summaryDot: {
    width: '8px',
    height: '8px',
    borderRadius: '999px',
  },
  summaryRow: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  summaryValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorText,
  },
  tableHeader: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
  },
});

interface TestCaseTableProps {
  datasetEvalMode?: string | null;
  diffFilter: 'all' | 'easy' | 'medium' | 'hard';
  onAddCase?: () => void;
  onDelete?: (testCase: any) => void;
  onDiffFilterChange: (filter: 'all' | 'easy' | 'medium' | 'hard') => void;
  onEdit?: (testCase: any) => void;
  onImport?: () => void;
  /** Navigate to the case definition page. */
  onOpen?: (testCase: any) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onPreview?: (testCase: any) => void;
  onSearchChange: (value: string) => void;
  pagination: { current: number; pageSize: number };
  readOnly?: boolean;
  search: string;
  selectedId?: string;
  testCases: any[];
  total: number;
}

const TestCaseTable = memo<TestCaseTableProps>(
  ({
    testCases,
    total,
    search,
    diffFilter,
    datasetEvalMode,
    pagination,
    onSearchChange,
    onDiffFilterChange,
    onPageChange,
    onPreview,
    onEdit,
    onOpen,
    onDelete,
    onAddCase,
    onImport,
    selectedId,
    readOnly,
  }) => {
    const { t } = useTranslation('eval');

    // Difficulty mix across the loaded cases — fuels the summary strip's
    // proportional bar and labeled counts. Cases without a difficulty are ignored.
    const difficulty = useMemo(() => {
      const counts = { easy: 0, hard: 0, medium: 0 };
      for (const c of testCases) {
        const d = c?.metadata?.difficulty as 'easy' | 'hard' | 'medium' | undefined;
        if (d === 'easy' || d === 'medium' || d === 'hard') counts[d] += 1;
      }
      const tagged = counts.easy + counts.medium + counts.hard;
      return {
        counts,
        segments: [
          { color: cssVar.colorSuccess, value: counts.easy },
          { color: cssVar.colorWarning, value: counts.medium },
          { color: cssVar.colorError, value: counts.hard },
        ],
        tagged,
      };
    }, [testCases]);

    const columns: TableColumn<any>[] = useMemo(() => {
      const base: TableColumn<any>[] = [
        {
          dataIndex: 'id',
          key: 'index',
          render: (_: any, __: any, index: number) => (
            <span
              style={{
                color: cssVar.colorTextTertiary,
                fontFamily: cssVar.fontFamilyCode,
                fontSize: 12,
              }}
            >
              {(pagination.current - 1) * pagination.pageSize + index + 1}
            </span>
          ),
          title: '#',
          width: 48,
        },
        {
          key: 'input',
          render: (_: any, record: any) => (
            <p
              style={{
                color: cssVar.colorText,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {record.content?.input}
            </p>
          ),
          title: t('table.columns.input'),
        },
        {
          ellipsis: true,
          key: 'expected',
          render: (_: any, record: any) => (
            <span style={{ color: cssVar.colorTextSecondary }}>
              {record.content?.expected || '-'}
            </span>
          ),
          title: t('table.columns.expected'),
          width: 200,
        },
        {
          dataIndex: 'evalMode',
          key: 'evalMode',
          render: (text: string) => {
            const effective = text ?? datasetEvalMode;
            if (!effective) return <span style={{ color: cssVar.colorTextQuaternary }}>-</span>;
            const isInherited = !text && !!datasetEvalMode;
            return (
              <span
                style={{
                  color: isInherited ? cssVar.colorTextQuaternary : cssVar.colorTextSecondary,
                  fontSize: 12,
                  fontStyle: isInherited ? 'italic' : 'normal',
                }}
              >
                {t(`evalMode.${effective}` as any)}
              </span>
            );
          },
          title: t('table.columns.evalMode'),
          width: 120,
        },
        {
          key: 'category',
          render: (_: any, record: any) => (
            <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
              {record.content?.category || '-'}
            </span>
          ),
          title: t('table.columns.category'),
          width: 120,
        },
      ];

      if (!readOnly) {
        base.push({
          key: 'actions',
          render: (_: any, record: any) => (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu
                trigger={['click']}
                items={[
                  ...(onOpen
                    ? [
                        {
                          icon: <ExternalLink size={14} />,
                          key: 'open',
                          label: t('testCaseDetail.open'),
                          onClick: () => onOpen(record),
                        },
                        { type: 'divider' as const },
                      ]
                    : []),
                  {
                    icon: <Pencil size={14} />,
                    key: 'edit',
                    label: t('common.edit'),
                    onClick: () => onEdit?.(record),
                  },
                  { type: 'divider' as const },
                  {
                    danger: true,
                    icon: <Trash2 size={14} />,
                    key: 'delete',
                    label: t('common.delete'),
                    onClick: () => onDelete?.(record),
                  },
                ]}
              >
                <ActionIcon icon={Ellipsis} size="small" />
              </DropdownMenu>
            </div>
          ),
          width: 48,
        });
      }

      return base;
    }, [pagination, readOnly, onEdit, onOpen, onDelete, t, datasetEvalMode]);

    return (
      <>
        <div {...stylex.props(styles.summaryRow)}>
          <Flexbox gap={2}>
            <span {...stylex.props(styles.summaryValue)}>{total}</span>
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {t('benchmark.detail.stats.cases')}
            </Text>
          </Flexbox>
          {difficulty.tagged > 0 && (
            <Flexbox flex={1} gap={6} style={{ maxWidth: 320, minWidth: 0 }}>
              <SegmentBar segments={difficulty.segments} />
              <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
                {(['easy', 'medium', 'hard'] as const).map((d) => (
                  <Flexbox horizontal align="center" gap={6} key={d}>
                    <span
                      {...sx([styles.summaryDot], undefined, {
                        background:
                          d === 'easy'
                            ? cssVar.colorSuccess
                            : d === 'medium'
                              ? cssVar.colorWarning
                              : cssVar.colorError,
                      })}
                    />
                    <Text color={cssVar.colorTextTertiary} fontSize={12}>
                      {t(`difficulty.${d}`)} {difficulty.counts[d]}
                    </Text>
                  </Flexbox>
                ))}
              </Flexbox>
            </Flexbox>
          )}
        </div>
        <div {...stylex.props(styles.filtersRow)}>
          <Flexbox horizontal align="center" gap={8}>
            <Input
              placeholder={t('testCase.search.placeholder')}
              prefix={<Search size={14} />}
              size="small"
              style={{ fontSize: 12, width: 192 }}
              value={search}
              onChange={(e) => {
                onSearchChange(e.target.value);
              }}
            />
            <div {...stylex.props(styles.filterContainer)}>
              {(['all', 'easy', 'medium', 'hard'] as const).map((f) => (
                <button
                  {...stylex.props(
                    styles.filterButton,
                    diffFilter === f ? styles.filterButtonActive : styles.filterButtonInactive,
                  )}
                  data-active={diffFilter === f}
                  key={f}
                  onClick={() => {
                    onDiffFilterChange(f);
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </Flexbox>
          {!readOnly && (
            <Flexbox horizontal gap={8}>
              <Button icon={FileUp} size="small" onClick={onImport}>
                {t('testCase.actions.import')}
              </Button>
              <Button icon={Plus} size="small" type="primary" onClick={onAddCase}>
                {t('testCase.actions.add')}
              </Button>
            </Flexbox>
          )}
        </div>
        <div className={moduleStyles.table}>
          <Table
            classNames={{ header: { cell: stylex.props(styles.tableHeader).className } }}
            columns={columns}
            dataSource={testCases}
            pagination={false}
            rowClassName={(record) => (record.id === selectedId ? 'row-selected' : '')}
            rowKey="id"
            size="small"
            onRow={
              readOnly
                ? undefined
                : (record) => ({
                    onClick: () => onPreview?.(record),
                  })
            }
          />
        </div>
        {total > pagination.pageSize && (
          <Flexbox
            horizontal
            align="center"
            justify="end"
            style={{ paddingBlock: 12, paddingInline: 16 }}
          >
            <Pagination
              current={pagination.current}
              pageSize={pagination.pageSize}
              size="small"
              total={total}
              onChange={onPageChange}
            />
          </Flexbox>
        )}
      </>
    );
  },
);

export default TestCaseTable;
