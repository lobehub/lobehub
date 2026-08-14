'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { FolderKanbanIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import ProjectSidebar from './Sidebar';

const ProjectLayout = memo(() => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const enabled = useUserStore(labPreferSelectors.enableProjects);

  if (!enabled) {
    return (
      <Center height="100%" width="100%">
        <Flexbox align="center" gap={12}>
          <Icon icon={FolderKanbanIcon} size={40} />
          <Text fontSize={18} weight={600}>
            {t('disabled.title')}
          </Text>
          <Button onClick={() => navigate('/settings/labs')}>{t('disabled.action')}</Button>
        </Flexbox>
      </Center>
    );
  }

  return (
    <>
      <ProjectSidebar />
      <Flexbox flex={1} height="100%" style={{ minWidth: 0 }}>
        <Outlet />
      </Flexbox>
    </>
  );
});

ProjectLayout.displayName = 'ProjectLayout';

export default ProjectLayout;
