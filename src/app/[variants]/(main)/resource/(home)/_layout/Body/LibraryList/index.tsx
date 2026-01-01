'use client';

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useCreateNewModal } from '@/features/LibraryModal';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useKnowledgeBaseStore } from '@/store/knowledgeBase';

import List from './List';

const KnowledgeBaseList = memo(() => {
  const { t } = useTranslation('file');
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data, isLoading } = useFetchKnowledgeBaseList();

  const navigate = useNavigate();

  const { open } = useCreateNewModal();

  const handleCreate = () => {
    open({
      onSuccess: (id) => {
        navigate(`/resource/library/${id}`);
      },
    });
  };

  if (isLoading) return <SkeletonList paddingInline={4} rows={3} />;

  if (data?.length === 0) return <EmptyNavItem onClick={handleCreate} title={t('library.new')} />;

  return <List />;
});

export default KnowledgeBaseList;
