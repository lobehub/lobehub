// Fixture: "Rename" opens a modal form.
import { Flexbox } from '@lobehub/ui';
import { DropdownMenu, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openRenameProjectModal } from './RenameProjectModal';

const ProjectHeader = memo<{ projectId: string; title: string }>(({ projectId, title }) => {
  const { t } = useTranslation('project');

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Text>{title}</Text>
      <DropdownMenu
        items={[
          {
            key: 'rename',
            label: t('rename'),
            onClick: () => openRenameProjectModal({ projectId, title }),
          },
        ]}
      />
    </Flexbox>
  );
});

export default ProjectHeader;
