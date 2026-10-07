'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { Button, confirmModal, Pagination, Segmented, toast } from '@lobehub/ui/base-ui';
import { SearchX } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';
import { stripSpeakerTags } from '@/features/Eval/components/inputPreview';
import { createTestCaseEditModal } from '@/features/Eval/TestCaseEditModal';
import { agentEvalService } from '@/services/agentEval';

import CaseRow, { type DatasetCase } from './CaseRow';
import { styles } from './style';

type Filter = 'all' | 'frozen' | 'text';

interface CasesSectionProps {
  cases: DatasetCase[];
  /** Rendered in place of the list while the first page loads or fails. */
  fallback?: ReactNode;
  offset: number;
  onPageChange: (page: number) => void;
  onRefresh: () => Promise<void>;
  page: number;
  pageSize: number;
  total: number;
}

const CasesSection = ({
  cases,
  fallback,
  offset,
  onPageChange,
  onRefresh,
  page,
  pageSize,
  total,
}: CasesSectionProps) => {
  const { t } = useTranslation('eval');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return cases
      .map((testCase, i) => ({ index: offset + i + 1, testCase }))
      .filter(({ testCase }) => {
        if (filter === 'frozen' && !testCase.hasFrozenCall) return false;
        if (filter === 'text' && testCase.hasFrozenCall) return false;
        if (!query) return true;
        return stripSpeakerTags(testCase.content?.input ?? '')
          .toLowerCase()
          .includes(query);
      });
  }, [cases, filter, offset, search]);

  const handleDelete = (testCase: DatasetCase) => {
    confirmModal({
      content: t('testCase.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('common.delete'),
      onOk: async () => {
        try {
          await agentEvalService.deleteTestCase(testCase.id);
          toast.success(t('testCase.delete.success'));
          await onRefresh();
        } catch {
          toast.error(t('testCase.delete.error'));
        }
      },
      title: t('dataset.case.deleteTitle'),
    });
  };

  const handleEdit = (testCase: DatasetCase) =>
    createTestCaseEditModal({ onSuccess: onRefresh, testCase: testCase as any });

  const filtered = search.trim() !== '' || filter !== 'all';

  return (
    <EvalSection
      count={total}
      description={t('dataset.cases.description')}
      title={t('dataset.detail.testCases')}
    >
      {fallback ?? (
        <Flexbox gap={12}>
          <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
            <Segmented
              size="small"
              value={filter}
              options={[
                { label: t('dataset.cases.filter.all'), value: 'all' },
                { label: t('dataset.case.frozen'), value: 'frozen' },
                { label: t('dataset.case.textOnly'), value: 'text' },
              ]}
              onChange={(value) => setFilter(value as Filter)}
            />
            <SearchBar
              allowClear
              placeholder={t('dataset.cases.search')}
              style={{ maxWidth: 280 }}
              value={search}
              variant={'filled'}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Flexbox>
          {visible.length > 0 ? (
            <div className={styles.list}>
              {visible.map(({ index, testCase }) => (
                <CaseRow
                  index={index}
                  key={testCase.id}
                  testCase={testCase}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                />
              ))}
            </div>
          ) : (
            <EvalEmpty
              compact
              icon={SearchX}
              title={t('dataset.cases.noMatch')}
              action={
                filtered && (
                  <Button
                    size="small"
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                    }}
                  >
                    {t('dataset.cases.clearFilters')}
                  </Button>
                )
              }
            />
          )}
          {total > pageSize && (
            <Flexbox horizontal justify="flex-end">
              <Pagination
                current={page}
                pageSize={pageSize}
                size="small"
                total={total}
                onChange={(next) => onPageChange(next)}
              />
            </Flexbox>
          )}
        </Flexbox>
      )}
    </EvalSection>
  );
};

export default CasesSection;
