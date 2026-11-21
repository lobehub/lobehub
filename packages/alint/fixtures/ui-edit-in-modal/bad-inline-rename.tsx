// Fixture: "Rename" from a menu swaps the project title for an inline input.
import { Flexbox } from '@lobehub/ui';
import { DropdownMenu, Input, Text } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ProjectHeaderProps {
  onRename: (title: string) => void;
  title: string;
}

const ProjectHeader = memo<ProjectHeaderProps>(({ onRename, title }) => {
  const { t } = useTranslation('project');
  const [renaming, setRenaming] = useState(false);

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      {renaming ? (
        // alint-expect
        <Input
          autoFocus
          defaultValue={title}
          onBlur={() => setRenaming(false)}
          onPressEnter={(event) => {
            onRename(event.currentTarget.value);
            setRenaming(false);
          }}
        />
      ) : (
        <Text>{title}</Text>
      )}
      <DropdownMenu
        items={[{ key: 'rename', label: t('rename'), onClick: () => setRenaming(true) }]}
      />
    </Flexbox>
  );
});

export default ProjectHeader;
