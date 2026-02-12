import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { BrainCircuitIcon } from 'lucide-react';
import { type FC } from 'react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MemoryAnalysis from '@/app/[variants]/(main)/memory/features/MemoryAnalysis';
import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/memory/features/TimeLineView/useScrollParent';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useQueryState } from '@/hooks/useQueryParam';
import { useUserMemoryStore } from '@/store/userMemory';

import EditableModal from '../features/EditableModal';
import FilterBar from '../features/FilterBar';
import Loading from '../features/Loading';
import { type ViewMode } from '../features/ViewModeSwitcher';
import ViewModeSwitcher from '../features/ViewModeSwitcher';
import ContextRightPanel from './features/ContextRightPanel';
import List from './features/List';

const ContextsArea = memo(() => {
  const { t } = useTranslation('memory');
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [searchValueRaw, setSearchValueRaw] = useQueryState('q', { clearOnDefault: true });
  const [sortValueRaw, setSortValueRaw] = useQueryState('sort', { clearOnDefault: true });

  const searchValue = searchValueRaw || '';
  const sortValue: 'capturedAt' | 'scoreImpact' | 'scoreUrgency' =
    sortValueRaw === 'scoreImpact' || sortValueRaw === 'scoreUrgency' ? sortValueRaw : 'capturedAt';

  const contextsPage = useUserMemoryStore((s) => s.contextsPage);
  const contextsInit = useUserMemoryStore((s) => s.contextsInit);
  const contextsTotal = useUserMemoryStore((s) => s.contextsTotal);
  const contextsSearchLoading = useUserMemoryStore((s) => s.contextsSearchLoading);
  const useFetchContexts = useUserMemoryStore((s) => s.useFetchContexts);
  const resetContextsList = useUserMemoryStore((s) => s.resetContextsList);

  const sortOptions = [
    { label: t('filter.sort.createdAt'), value: 'capturedAt' },
    { label: t('filter.sort.scoreImpact'), value: 'scoreImpact' },
    { label: t('filter.sort.scoreUrgency'), value: 'scoreUrgency' },
  ];

  // 转换 sort：capturedAt 转为 undefined（后端默认）
  const apiSort =
    sortValue === 'capturedAt' ? undefined : (sortValue as 'scoreImpact' | 'scoreUrgency');

  // 当搜索或排序变化时重置列表
  useEffect(() => {
    if (!apiSort) return;
    const sort = viewMode === 'grid' ? apiSort : undefined;
    resetContextsList({ q: searchValue || undefined, sort });
  }, [searchValue, apiSort, viewMode]);

  // 调用 SWR hook 获取数据
  const { isLoading } = useFetchContexts({
    page: contextsPage,
    pageSize: 12,
    q: searchValue || undefined,
    sort: viewMode === 'grid' ? apiSort : undefined,
  });

  // Handle search and sort changes
  const handleSearch = useCallback(
    (value: string) => {
      setSearchValueRaw(value || null);
    },
    [setSearchValueRaw],
  );

  const handleSortChange = useCallback(
    (sort: string) => {
      setSortValueRaw(sort);
    },
    [setSortValueRaw],
  );

  // 显示 loading：搜索/重置中 或 首次加载中
  const showLoading = contextsSearchLoading || !contextsInit;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          Boolean(contextsTotal) && (
            <Tag icon={<Icon icon={BrainCircuitIcon} />}>{contextsTotal}</Tag>
          )
        }
        right={
          <>
            <MemoryAnalysis iconOnly />
            <ViewModeSwitcher value={viewMode} onChange={setViewMode} />
            <WideScreenButton />
          </>
        }
      />
      <Flexbox
        height={'100%'}
        id={SCROLL_PARENT_ID}
        style={{ overflowY: 'auto', paddingBottom: '16vh' }}
        width={'100%'}
      >
        <WideScreenContainer gap={32} paddingBlock={48}>
          <FilterBar
            searchValue={searchValue}
            sortOptions={viewMode === 'grid' ? sortOptions : undefined}
            sortValue={sortValue}
            onSearch={handleSearch}
            onSortChange={viewMode === 'grid' ? handleSortChange : undefined}
          />
          {showLoading ? (
            <Loading viewMode={viewMode} />
          ) : (
            <List isLoading={isLoading} searchValue={searchValue} viewMode={viewMode} />
          )}
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

const Contexts: FC = () => {
  return (
    <>
      <Flexbox horizontal height={'100%'} width={'100%'}>
        <ContextsArea />
        <ContextRightPanel />
      </Flexbox>
      <EditableModal />
    </>
  );
};

export default Contexts;
