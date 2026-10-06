// Fixture: renaming a topic through a popover input anchored to the row.
import { Flexbox } from '@lobehub/ui';
import { DropdownMenu, Input, Popover, Text } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface TopicRowProps {
  onRename: (title: string) => void;
  title: string;
}

const TopicRow = memo<TopicRowProps>(({ onRename, title }) => {
  const { t } = useTranslation('topic');
  const [renaming, setRenaming] = useState(false);

  return (
    <Popover
      open={renaming}
      content={
        // alint-expect
        <Input
          autoFocus
          defaultValue={title}
          onPressEnter={(event) => {
            onRename(event.currentTarget.value);
            setRenaming(false);
          }}
        />
      }
      onOpenChange={setRenaming}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <Text>{title}</Text>
        <DropdownMenu
          items={[{ key: 'rename', label: t('rename'), onClick: () => setRenaming(true) }]}
        />
      </Flexbox>
    </Popover>
  );
});

export default TopicRow;
