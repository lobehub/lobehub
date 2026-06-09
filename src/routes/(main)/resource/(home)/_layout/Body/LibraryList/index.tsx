'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useKnowledgeBaseStore } from '@/store/library';

import Item from './Item';

/**
 * Show library list in the sidebar
 */
const LibraryList = memo(() => {
  const { t } = useTranslation('file');
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data, isLoading } = useFetchKnowledgeBaseList();

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

  if (isLoading) return <SkeletonList paddingInline={4} rows={3} />;

  if (data?.length === 0)
    return <EmptyNavItem disabled={!canCreate} title={t('library.new')} onClick={handleCreate} />;

  return (
    <Flexbox gap={1} paddingInline={4}>
      {data?.map((item) => (
        <Item description={item.description} id={item.id} key={item.id} name={item.name} />
      ))}
    </Flexbox>
  );
});

export default LibraryList;
