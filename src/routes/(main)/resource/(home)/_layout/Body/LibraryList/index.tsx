'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { useKnowledgeBaseStore } from '@/store/library';

import Item from './Item';

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
  // `isValidating` catches the first fetch after switching mode — SWR's key
  // has no cache yet, and because `useFetchKnowledgeBaseList` sets
  // `fallbackData: []`, `isLoading` collapses to false immediately. Without
  // this, the sidebar flashes the empty state for the network round-trip
  // before the real list arrives.
  const { data, isLoading, isValidating } = useFetchKnowledgeBaseList(visibility);

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

  if (isLoading || (isValidating && (data?.length ?? 0) === 0))
    return <SkeletonList paddingInline={4} rows={3} />;

  if (data?.length === 0)
    return (
      <EmptyNavItem
        disabled={!canCreate}
        title={t(listVisibility === 'private' ? 'library.privateEmpty' : 'library.workspaceEmpty')}
        onClick={handleCreate}
      />
    );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {data?.map((item) => (
        <Item
          description={item.description}
          id={item.id}
          key={item.id}
          name={item.name}
          userId={item.userId}
          visibility={item.visibility}
        />
      ))}
    </Flexbox>
  );
});

export default LibraryList;
