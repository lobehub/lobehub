'use client';

import { Button, Flexbox, Input } from '@lobehub/ui';
import { Badge, Card, Modal, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStaticStyles } from 'antd-style';
import { Eye, Search } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    .ant-card-body {
      padding: 0;
    }
  `,
  filterButton: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: none;

    font-size: 11px;
    font-weight: 500;
    text-transform: capitalize;

    background: transparent;

    transition: all 0.2s;

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
  `,
  filterContainer: css`
    overflow: hidden;
    display: flex;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;
  `,
  header: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headerTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  indexCell: css`
    font-family: monospace;
    font-size: 12px;
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
  modalContent: css`
    .ant-modal-content {
      padding: 24px;
    }
  `,
  previewBlock: css`
    padding: 12px;
    border-radius: 8px;

    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillSecondary};
  `,
  previewLabel: css`
    margin: 0;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
  `,
  searchIcon: css`
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 10px;
    transform: translateY(-50%);

    color: ${cssVar.colorTextTertiary};
  `,
  searchInput: css`
    width: 192px;
    padding-inline-start: 32px;
    font-size: 12px;
  `,
  table: css`
    .ant-table {
      font-size: 14px;
    }

    .ant-table-thead > tr > th {
      font-size: 12px;
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
  viewButton: css`
    width: 28px;
    height: 28px;
    padding: 0;
    color: ${cssVar.colorTextTertiary};
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
  const [previewCase, setPreviewCase] = useState<any | null>(null);

  const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);

  const { data: testCaseData, isLoading: loading } = useFetchTestCases({
    datasetId,
    limit: pagination.pageSize,
    offset: (pagination.current - 1) * pagination.pageSize,
  });

  const data = testCaseData?.data || [];

  // Client-side filtering
  const filteredData = data.filter((c: any) => {
    if (diffFilter !== 'all' && c.metadata?.difficulty !== diffFilter) return false;
    if (search && !c.content?.input?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const getDifficultyBadge = (difficulty: string) => {
    const config: Record<string, { bg: string; color: string }> = {
      easy: {
        bg: 'var(--ant-color-success-bg)',
        color: 'var(--ant-color-success)',
      },
      hard: {
        bg: 'var(--ant-color-error-bg)',
        color: 'var(--ant-color-error)',
      },
      medium: {
        bg: 'var(--ant-color-warning-bg)',
        color: 'var(--ant-color-warning)',
      },
    };

    const c = config[difficulty] || config.easy;
    return (
      <Badge
        style={{
          backgroundColor: c.bg,
          borderColor: c.color + '30',
          color: c.color,
          fontSize: 11,
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
                  borderColor: 'var(--ant-color-border)',
                  color: 'var(--ant-color-text-tertiary)',
                  fontSize: 10,
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
        <Button
          className={styles.viewButton}
          icon={Eye}
          size="small"
          variant="text"
          onClick={() => setPreviewCase(record)}
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

      {/* Preview Modal */}
      <Modal
        className={styles.modalContent}
        footer={null}
        open={!!previewCase}
        title={t('testCase.preview.title')}
        width={600}
        onCancel={() => setPreviewCase(null)}
      >
        {previewCase && (
          <Flexbox gap={16}>
            <Flexbox gap={4}>
              <p className={styles.previewLabel}>{t('testCase.preview.input')}</p>
              <div className={styles.previewBlock}>{previewCase.content?.input}</div>
            </Flexbox>
            <Flexbox gap={4}>
              <p className={styles.previewLabel}>{t('testCase.preview.expected')}</p>
              <div className={styles.previewBlock}>
                {previewCase.content?.expectedOutput || '-'}
              </div>
            </Flexbox>
            <Flexbox horizontal align="center" gap={8}>
              {previewCase.metadata?.difficulty &&
                getDifficultyBadge(previewCase.metadata.difficulty)}
              {previewCase.metadata?.tags?.map((tag: string) => (
                <Badge
                  key={tag}
                  style={{
                    backgroundColor: 'transparent',
                    borderColor: 'var(--ant-color-border)',
                    color: 'var(--ant-color-text-tertiary)',
                    fontSize: 12,
                  }}
                >
                  {tag}
                </Badge>
              ))}
            </Flexbox>
          </Flexbox>
        )}
      </Modal>
    </>
  );
});

export default TestCasesTab;
