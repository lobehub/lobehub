'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { FolderKanbanIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const ProjectDisabled = () => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <Center height={'100%'} width={'100%'}>
      <Flexbox align={'center'} gap={12}>
        <Icon icon={FolderKanbanIcon} size={40} />
        <Text fontSize={18} weight={600}>
          {t('disabled.title')}
        </Text>
        <Button onClick={() => navigate('/settings/labs')}>{t('disabled.action')}</Button>
      </Flexbox>
    </Center>
  );
};

export default ProjectDisabled;
