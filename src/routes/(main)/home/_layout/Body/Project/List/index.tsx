'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { LIBRARY_URL } from '@/const/url';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useKnowledgeBaseStore } from '@/store/library';

import { useProjectMenuItems } from '../../../hooks';
import Item from './Item';

const ProjectList = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useWorkspaceAwareNavigate();
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data, isLoading } = useFetchKnowledgeBaseList();
  const { createProject } = useProjectMenuItems();

  if (!data || isLoading) return <SkeletonList />;

  const isEmpty = data.length === 0;

  if (isEmpty) {
    return <EmptyNavItem title={t('project.create')} onClick={createProject} />;
  }

  return (
    <Flexbox gap={1}>
      {data.map((item) => (
        <WorkspaceLink
          aria-label={item.id}
          key={item.id}
          to={LIBRARY_URL(item.id)}
          onClick={(e) => {
            e.preventDefault();
            navigate(LIBRARY_URL(item.id));
          }}
        >
          <Item {...item} key={item.id} />
        </WorkspaceLink>
      ))}
    </Flexbox>
  );
});

export default ProjectList;
