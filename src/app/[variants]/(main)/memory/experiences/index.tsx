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
import ExperienceRightPanel from './features/ExperienceRightPanel';
import List from './features/List';

const ExperiencesArea = memo(() => {
  const { t } = useTranslation('memory');
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [searchValueRaw, setSearchValueRaw] = useQueryState('q', { clearOnDefault: true });
  const [sortValueRaw, setSortValueRaw] = useQueryState('sort', { clearOnDefault: true });

  const searchValue = searchValueRaw || '';
  const sortValue: 'capturedAt' | 'scoreConfidence' =
    sortValueRaw === 'scoreConfidence' ? 'scoreConfidence' : 'capturedAt';

  const experiencesPage = useUserMemoryStore((s) => s.experiencesPage);
  const experiencesInit = useUserMemoryStore((s) => s.experiencesInit);
  const experiencesTotal = useUserMemoryStore((s) => s.experiencesTotal);
  const experiencesSearchLoading = useUserMemoryStore((s) => s.experiencesSearchLoading);
  const useFetchExperiences = useUserMemoryStore((s) => s.useFetchExperiences);
  const resetExperiencesList = useUserMemoryStore((s) => s.resetExperiencesList);

  const sortOptions = [
    { label: t('filter.sort.createdAt'), value: 'capturedAt' },
    { label: t('filter.sort.scoreConfidence'), value: 'scoreConfidence' },
  ];

  // 转换 sort：capturedAt 转为 undefined（后端默认）
  const apiSort = sortValue === 'capturedAt' ? undefined : (sortValue as 'scoreConfidence');

  // 当搜索或排序变化时重置列表
  useEffect(() => {
    if (!apiSort) return;
    const sort = viewMode === 'grid' ? apiSort : undefined;
    resetExperiencesList({ q: searchValue || undefined, sort });
  }, [searchValue, apiSort, viewMode]);

  // 调用 SWR hook 获取数据
  const { isLoading } = useFetchExperiences({
    page: experiencesPage,
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
  const showLoading = experiencesSearchLoading || !experiencesInit;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          Boolean(experiencesTotal) && (
            <Tag icon={<Icon icon={BrainCircuitIcon} />}>{experiencesTotal}</Tag>
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

const Experiences: FC = () => {
  return (
    <>
      <Flexbox horizontal height={'100%'} width={'100%'}>
        <ExperiencesArea />
        <ExperienceRightPanel />
      </Flexbox>
      <EditableModal />
    </>
  );
};

export default Experiences;
