import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { CalendarClockIcon } from 'lucide-react';
import { type FC } from 'react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import ActivityRightPanel from './features/ActivityRightPanel';
import List from './features/List';

const ActivitiesArea = memo(() => {
  const { t } = useTranslation('memory');
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [searchValueRaw, setSearchValueRaw] = useQueryState('q', { clearOnDefault: true });
  const [sortValueRaw, setSortValueRaw] = useQueryState('sort', { clearOnDefault: true });

  const searchValue = searchValueRaw || '';
  const sortValue: 'capturedAt' | 'startsAt' =
    sortValueRaw === 'startsAt' ? 'startsAt' : 'capturedAt';

  const activitiesPage = useUserMemoryStore((s) => s.activitiesPage);
  const activitiesInit = useUserMemoryStore((s) => s.activitiesInit);
  const activitiesTotal = useUserMemoryStore((s) => s.activitiesTotal);
  const activitiesSearchLoading = useUserMemoryStore((s) => s.activitiesSearchLoading);
  const useFetchActivities = useUserMemoryStore((s) => s.useFetchActivities);
  const resetActivitiesList = useUserMemoryStore((s) => s.resetActivitiesList);

  const sortOptions = [
    { label: t('filter.sort.createdAt'), value: 'capturedAt' },
    { label: t('filter.sort.startsAt'), value: 'startsAt' },
  ];

  const apiSort = sortValue === 'capturedAt' ? undefined : (sortValue as 'startsAt');

  useEffect(() => {
    if (!apiSort) return;
    const sort = viewMode === 'grid' ? apiSort : undefined;
    resetActivitiesList({ q: searchValue || undefined, sort });
  }, [searchValue, apiSort, viewMode]);

  const { isLoading } = useFetchActivities({
    page: activitiesPage,
    pageSize: 12,
    q: searchValue || undefined,
    sort: viewMode === 'grid' ? apiSort : undefined,
  });

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

  const showLoading = activitiesSearchLoading || !activitiesInit;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          Boolean(activitiesTotal) && (
            <Tag icon={<Icon icon={CalendarClockIcon} />}>{activitiesTotal}</Tag>
          )
        }
        right={
          <>
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

const Activities: FC = () => {
  return (
    <>
      <Flexbox horizontal height={'100%'} width={'100%'}>
        <ActivitiesArea />
        <ActivityRightPanel />
      </Flexbox>
      <EditableModal />
    </>
  );
};

export default Activities;
