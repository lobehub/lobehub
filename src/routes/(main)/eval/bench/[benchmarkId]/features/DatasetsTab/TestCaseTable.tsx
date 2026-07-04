import { ActionIcon, Button, DropdownMenu, Flexbox, Input, Text } from '@lobehub/ui';
import { Pagination, Table } from 'antd';
import { type ColumnsType } from 'antd/es/table';
import { createStaticStyles, cssVar } from 'antd-style';
import { Ellipsis, FileUp, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SegmentBar from '../../../../features/SegmentBar';

const styles = createStaticStyles(({ css }) => ({
  filterButton: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 8px;
    border: none;

    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    text-transform: capitalize;

    background: transparent;

    transition:
      color 0.15s ease,
      background 0.15s ease;

    &[data-active='true'] {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &[data-active='false'] {
      color: ${cssVar.colorTextTertiary};

      &:hover {
        color: ${cssVar.colorText};
      }
    }

    &:not(:first-child) {
      border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  filterContainer: css`
    overflow: hidden;
    display: flex;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusSM};
  `,
  filtersRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  // Summary strip — leads the table with the case total as a mono figure plus a
  // proportional read of the difficulty mix across the loaded cases.
  summaryDot: css`
    width: 8px;
    height: 8px;
    border-radius: 999px;
  `,
  summaryRow: css`
    display: flex;
    gap: 16px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  summaryValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  table: css`
    .ant-table {
      font-size: ${cssVar.fontSize};
    }

    .ant-table-thead > tr > th {
      font-size: ${cssVar.fontSizeSM};
      font-weight: 500;
      color: ${cssVar.colorTextTertiary};
      background: ${cssVar.colorFillQuaternary};
    }

    .ant-table-tbody > tr {
      &.row-clickable {
        cursor: pointer;
      }

      &:hover {
        background: ${cssVar.colorFillQuaternary};
      }

      &.row-selected {
        background: ${cssVar.colorPrimaryBg};
      }
    }
  `,
}));

interface TestCaseTableProps {
  datasetEvalMode?: string | null;
  diffFilter: 'all' | 'easy' | 'medium' | 'hard';
  onAddCase?: () => void;
  onDelete?: (testCase: any) => void;
  onDiffFilterChange: (filter: 'all' | 'easy' | 'medium' | 'hard') => void;
  onEdit?: (testCase: any) => void;
  onImport?: () => void;
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

    const columns: ColumnsType<any> = useMemo(() => {
      const base: ColumnsType<any> = [
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
          dataIndex: ['content', 'input'],
          key: 'input',
          render: (text: string) => (
            <p
              style={{
                color: cssVar.colorText,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {text}
            </p>
          ),
          title: t('table.columns.input'),
        },
        {
          dataIndex: ['content', 'expected'],
          ellipsis: true,
          key: 'expected',
          render: (text: string) => (
            <span style={{ color: cssVar.colorTextSecondary }}>{text || '-'}</span>
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
          dataIndex: ['content', 'category'],
          key: 'category',
          render: (text: string) => (
            <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>{text || '-'}</span>
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
    }, [pagination, readOnly, onEdit, onDelete, t, datasetEvalMode]);

    return (
      <>
        <div className={styles.summaryRow}>
          <Flexbox gap={2}>
            <span className={styles.summaryValue}>{total}</span>
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
                      className={styles.summaryDot}
                      style={{
                        background:
                          d === 'easy'
                            ? cssVar.colorSuccess
                            : d === 'medium'
                              ? cssVar.colorWarning
                              : cssVar.colorError,
                      }}
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
        <div className={styles.filtersRow}>
          <Flexbox horizontal align="center" gap={8}>
            <div style={{ position: 'relative' }}>
              <Search
                size={14}
                style={{
                  color: cssVar.colorTextTertiary,
                  left: 12,
                  position: 'absolute',
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              />
              <Input
                placeholder={t('testCase.search.placeholder')}
                size="small"
                value={search}
                style={{
                  fontSize: 12,
                  paddingLeft: 32,
                  width: 192,
                }}
                onChange={(e) => {
                  onSearchChange(e.target.value);
                }}
              />
            </div>
            <div className={styles.filterContainer}>
              {(['all', 'easy', 'medium', 'hard'] as const).map((f) => (
                <button
                  className={styles.filterButton}
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
        <div className={styles.table}>
          <Table
            columns={columns}
            dataSource={testCases}
            pagination={false}
            rowKey="id"
            size="small"
            rowClassName={(record) => {
              const classes: string[] = [];
              if (!readOnly) classes.push('row-clickable');
              if (record.id === selectedId) classes.push('row-selected');
              return classes.join(' ');
            }}
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
              simple
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
