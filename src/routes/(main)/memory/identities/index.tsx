import { Flexbox, Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { BrainCircuitIcon } from 'lucide-react';
import { type FC } from 'react';
import { memo, useCallback, useState } from 'react';

import { MemoryListBoundary } from '@/features/Memory';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useQueryState } from '@/hooks/useQueryParam';
import ActionBar from '@/routes/(main)/memory/features/ActionBar';
import CommonFilterBar from '@/routes/(main)/memory/features/FilterBar';
import { identitySelectors, useUserMemoryStore } from '@/store/userMemory';
import {
  DEFAULT_IDENTITY_LIST_PAGE_SIZE,
  isIdentityQueryCurrent,
} from '@/store/userMemory/slices/identity/projection';
import { type TypesEnum } from '@/types/userMemory';

import EditableModal from '../features/EditableModal';
import Loading from '../features/Loading';
import { SCROLL_PARENT_ID } from '../features/TimeLineView/useScrollParent';
import { type ViewMode } from '../features/ViewModeSwitcher';
import ViewModeSwitcher from '../features/ViewModeSwitcher';
import IdentityRightPanel from './features/IdentityRightPanel';
import { type IdentityType } from './features/List';
import List from './features/List';
import SegmentedBar from './features/SegmentedBar';
import { showIdentityControls } from './showIdentityControls';

const IdentitiesArea = memo(() => {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [searchValueRaw, setSearchValueRaw] = useQueryState('q', { clearOnDefault: true });
  const [typeFilterRaw, setTypeFilterRaw] = useQueryState('type', { clearOnDefault: true });

  const searchValue = searchValueRaw || '';
  const typeFilter = (typeFilterRaw as IdentityType) || 'all';

  const identities = useUserMemoryStore((s) => s.identities);
  const identitiesMeta = useUserMemoryStore((s) => s.identitiesMeta);
  const identitiesInit = useUserMemoryStore(identitySelectors.isIdentitiesInitialized);
  const identitiesTotal = useUserMemoryStore(identitySelectors.identitiesTotal);
  const useFetchIdentities = useUserMemoryStore((s) => s.useFetchIdentities);

  const requestedTypes = typeFilter === 'all' ? undefined : [typeFilter as TypesEnum];
  const requestedQuery = { q: searchValue || undefined, types: requestedTypes };

  // Hydrate the persisted head page, then revalidate. The rows land in
  // `identities` — read them from the store, never from this hook.
  const { error, isValidating, revalidate } = useFetchIdentities({
    pageSize: DEFAULT_IDENTITY_LIST_PAGE_SIZE,
    ...requestedQuery,
  });

  // A page painted for another filter set is not the answer on screen yet: the
  // replica keeps the previous query's rows until the new head page lands, so
  // the boundary must not read them as this query's (empty) result.
  const isStaleQuery = !isIdentityQueryCurrent(identitiesMeta, requestedQuery);
  // The replica is the source of truth once it has painted: a failed background
  // revalidation must not blow away rows the local copy already holds. Only an
  // empty list predates the error, so only then is it a full-surface failure.
  const showError = !identitiesInit && Boolean(error);
  const isResetting = isStaleQuery && !error;

  // Handle search and type changes
  const handleSearch = useCallback(
    (value: string) => {
      setSearchValueRaw(value || null);
    },
    [setSearchValueRaw],
  );

  const handleTypeChange = useCallback(
    (type: IdentityType) => {
      setTypeFilterRaw(type === 'all' ? null : type);
    },
    [setTypeFilterRaw],
  );

  // Action bar, type tabs and search are controls over nothing on an empty
  // collection, so they only render once there is something to act on.
  const showControls = showIdentityControls({
    hasFilters: Boolean(searchValue) || typeFilter !== 'all',
    init: identitiesInit,
    searchLoading: isStaleQuery,
    total: identitiesTotal,
  });

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          Boolean(identitiesTotal) && (
            <Tag icon={<Icon icon={BrainCircuitIcon} />}>{identitiesTotal}</Tag>
          )
        }
        right={
          showControls && (
            <ActionBar showAnalysis showPurge>
              <ViewModeSwitcher value={viewMode} onChange={setViewMode} />
              <WideScreenButton />
            </ActionBar>
          )
        }
      />
      <Flexbox
        height={'100%'}
        id={SCROLL_PARENT_ID}
        style={{ overflowY: 'auto', paddingBottom: '16vh' }}
        width={'100%'}
      >
        <WideScreenContainer gap={32} paddingBlock={48}>
          {showControls && (
            <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
              <SegmentedBar typeValue={typeFilter} onTypeChange={handleTypeChange} />
              <CommonFilterBar searchValue={searchValue} onSearch={handleSearch} />
            </Flexbox>
          )}
          <MemoryListBoundary
            data={identitiesInit && !isResetting ? identities : undefined}
            error={showError ? error : undefined}
            isInitialized={identitiesInit}
            isLoading={isValidating}
            isResetting={isResetting}
            loading={<Loading viewMode={viewMode} />}
            onRetry={() => void revalidate()}
          >
            <List isLoading={isValidating} searchValue={searchValue} viewMode={viewMode} />
          </MemoryListBoundary>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

const Identities: FC = () => {
  return (
    <>
      <Flexbox horizontal height={'100%'} width={'100%'}>
        <IdentitiesArea />
        <IdentityRightPanel />
      </Flexbox>
      <EditableModal />
    </>
  );
};

export default Identities;
