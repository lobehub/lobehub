'use client';

import { ActionIcon, Flexbox, Input, Text } from '@lobehub/ui';
import { Badge, Card, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStaticStyles, cssVar } from 'antd-style';
import { Eye, Search } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

import SegmentBar from '../../../../features/SegmentBar';
import { createTestCasePreviewModal } from '../TestCasePreviewModal';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    .ant-card-body {
      padding: 0;
    }
  `,
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
  header: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headerTitle: css`
    font-size: ${cssVar.fontSize};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  indexCell: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  inputCell: css`
    overflow: hidden;

    max-width: 400px;
    margin: 0;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  // Summary strip — case total as a mono figure plus the difficulty mix bar,
  // sitting between the title row and the table.
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
  searchIcon: css`
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 12px;
    transform: translateY(-50%);

    color: ${cssVar.colorTextTertiary};
  `,
  searchInput: css`
    width: 192px;
    padding-inline-start: 32px;
    font-size: ${cssVar.fontSizeSM};
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
      &:hover {
        background: ${cssVar.colorFillQuaternary};
      }
    }
  `,
}));

interface TestCasesTabProps {
  datasetId: string;
}

const TestCasesTab = memo<TestCasesTabProps>(({ datasetId }) => {
  const { t } = useTranslation('eval');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 8 });
  const [search, setSearch] = useState('');
  const [diffFilter, setDiffFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');

  const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);

  const { data: testCaseData, isLoading: loading } = useFetchTestCases({
    datasetId,
    limit: pagination.pageSize,
    offset: (pagination.current - 1) * pagination.pageSize,
  });

  const data = testCaseData?.data || [];
  const total = testCaseData?.total || 0;

  // Difficulty mix across the loaded page — drives the summary strip's bar.
  const difficulty = useMemo(() => {
    const counts = { easy: 0, hard: 0, medium: 0 };
    for (const c of data) {
      const d = c?.metadata?.difficulty as 'easy' | 'hard' | 'medium' | undefined;
      if (d === 'easy' || d === 'medium' || d === 'hard') counts[d] += 1;
    }
    return {
      counts,
      segments: [
        { color: cssVar.colorSuccess, value: counts.easy },
        { color: cssVar.colorWarning, value: counts.medium },
        { color: cssVar.colorError, value: counts.hard },
      ],
      tagged: counts.easy + counts.medium + counts.hard,
    };
  }, [data]);

  // Client-side filtering
  const filteredData = data.filter((c: any) => {
    if (diffFilter !== 'all' && c.metadata?.difficulty !== diffFilter) return false;
    if (search && !c.content?.input?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const getDifficultyBadge = (difficulty: string) => {
    const config: Record<string, { bg: string; color: string }> = {
      easy: {
        bg: cssVar.colorSuccessBg,
        color: cssVar.colorSuccess,
      },
      hard: {
        bg: cssVar.colorErrorBg,
        color: cssVar.colorError,
      },
      medium: {
        bg: cssVar.colorWarningBg,
        color: cssVar.colorWarning,
      },
    };

    const c = config[difficulty] || config.easy;
    return (
      <Badge
        style={{
          backgroundColor: c.bg,
          borderColor: c.color + '30',
          color: c.color,
          fontSize: 12,
          textTransform: 'capitalize',
        }}
      >
        {difficulty}
      </Badge>
    );
  };

  const columns: ColumnsType<any> = [
    {
      dataIndex: 'id',
      key: 'index',
      render: (_: any, __: any, index: number) => (
        <span className={styles.indexCell}>
          {(pagination.current - 1) * pagination.pageSize + index + 1}
        </span>
      ),
      title: '#',
      width: 64,
    },
    {
      dataIndex: ['content', 'input'],
      ellipsis: true,
      key: 'input',
      render: (text: string) => <p className={styles.inputCell}>{text}</p>,
      title: t('table.columns.input'),
    },
    {
      dataIndex: ['metadata', 'difficulty'],
      key: 'difficulty',
      render: (difficulty: string) => (difficulty ? getDifficultyBadge(difficulty) : '-'),
      title: t('table.columns.difficulty'),
      width: 96,
    },
    {
      dataIndex: ['metadata', 'tags'],
      key: 'tags',
      render: (tags: string[]) =>
        tags?.length > 0 ? (
          <Flexbox horizontal gap={4}>
            {tags.slice(0, 1).map((tag) => (
              <Badge
                key={tag}
                style={{
                  backgroundColor: 'transparent',
                  borderColor: cssVar.colorBorder,
                  color: cssVar.colorTextTertiary,
                  fontSize: 12,
                }}
              >
                {tag}
              </Badge>
            ))}
          </Flexbox>
        ) : (
          '-'
        ),
      title: t('table.columns.tags'),
      width: 112,
    },
    {
      key: 'actions',
      render: (_: any, record: any) => (
        <ActionIcon
          icon={Eye}
          size="small"
          onClick={() => createTestCasePreviewModal({ testCase: record })}
        />
      ),
      width: 64,
    },
  ];

  return (
    <>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Flexbox horizontal align="center" justify="space-between">
            <span className={styles.headerTitle}>{t('benchmark.detail.tabs.data')}</span>
            <Flexbox horizontal align="center" gap={12}>
              <div style={{ position: 'relative' }}>
                <Search className={styles.searchIcon} size={14} />
                <Input
                  className={styles.searchInput}
                  placeholder={t('testCase.search.placeholder')}
                  size="small"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPagination({ ...pagination, current: 1 });
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
                      setDiffFilter(f);
                      setPagination({ ...pagination, current: 1 });
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </Flexbox>
          </Flexbox>
        </div>

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

        <div className={styles.table}>
          <Table
            columns={columns}
            dataSource={filteredData}
            loading={loading}
            rowKey="id"
            size="middle"
            pagination={{
              current: pagination.current,
              onChange: (page, pageSize) => setPagination({ current: page, pageSize }),
              pageSize: pagination.pageSize,
              showSizeChanger: false,
              total: filteredData.length,
            }}
          />
        </div>
      </Card>
    </>
  );
});

export default TestCasesTab;
