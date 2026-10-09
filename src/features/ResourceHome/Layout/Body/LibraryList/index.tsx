'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useCreateNewModal } from '@/features/LibraryModal';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

import Item from './Item';
import { getLibraryListAsyncState } from './state';

/**
 * Show library list in the sidebar
 */
const LibraryList = memo(() => {
  const { t } = useTranslation('file');
  // Mirrors the file-explorer mode: `private` → only own private KBs,
  // `workspace` → only public KBs. Personal-mode users never render this list
  // with a filter (the toggle isn't shown), so `visibility` stays undefined
  // and the query returns everything the ownership predicate allows.
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const visibility = listVisibility === 'private' ? ('private' as const) : ('public' as const);

  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  // The rows are read from the local-first replica view, the hook only reports
  // the sync flags. `!isHydrated` covers the window before the persisted row is
  // read and `isValidating` the first network round-trip, so the sidebar shows
  // the skeleton instead of flashing the empty state for the round-trip.
  // A failed KB-list fetch must branch to the error state before empty (Read
  // §1.1 failure-as-empty): read `error` / `revalidate` and branch first.
  const { error, isHydrated, isValidating, revalidate } = useFetchKnowledgeBaseList(visibility);
  const data = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseList(visibility));

  const navigate = useWorkspaceAwareNavigate();

  const { open } = useCreateNewModal();
  const { allowed: canCreate } = usePermission('create_content');

  const handleCreate = () => {
    if (!canCreate) return;
    open({
      onSuccess: (id) => {
        navigate(`/resource/library/${id}`);
      },
    });
  };

  const {
    boundaryData,
    isEmpty,
    isLoading: showSkeleton,
  } = getLibraryListAsyncState({ data, isLoading: !isHydrated, isValidating });

  return (
    <AsyncBoundary
      data={boundaryData}
      error={error}
      errorVariant={'inline'}
      isEmpty={isEmpty}
      isLoading={showSkeleton}
      loading={<SkeletonList paddingInline={4} rows={3} />}
      empty={
        <EmptyNavItem
          disabled={!canCreate}
          title={t(
            listVisibility === 'private' ? 'library.privateEmpty' : 'library.workspaceEmpty',
          )}
          onClick={handleCreate}
        />
      }
      onRetry={() => revalidate()}
    >
      <Flexbox gap={1} paddingInline={4}>
        {data?.map((item) => (
          <Item
            description={item.description}
            id={item.id}
            key={item.id}
            memberRestricted={(item as { memberRestricted?: boolean }).memberRestricted}
            name={item.name}
            permissionManageable={(item as { permissionManageable?: boolean }).permissionManageable}
            userId={item.userId}
            visibility={item.visibility}
          />
        ))}
      </Flexbox>
    </AsyncBoundary>
  );
});

export default LibraryList;
