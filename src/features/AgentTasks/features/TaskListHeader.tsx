import { ActionIcon, Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ClipboardList } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface TaskListHeaderProps {
  count?: number;
  onViewAll?: () => void;
}

const TaskListHeader = memo<TaskListHeaderProps>(({ onViewAll, count }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox
      horizontal
      align={'center'}
      justify={'space-between'}
      paddingBlock={8}
      paddingInline={8}
    >
      <Flexbox horizontal align="center" gap={8}>
        <ActionIcon
          shadow
          icon={ClipboardList}
          size={16}
          variant={'outlined'}
          onClick={onViewAll}
        />
        <Text weight={500}>{t('taskList.title')}</Text>
        <Text color={cssVar.colorTextQuaternary} fontSize={12}>
          {count}
        </Text>
      </Flexbox>
      <Button
        size={'small'}
        type={'text'}
        style={{
          color: cssVar.colorTextDescription,
        }}
        onClick={onViewAll}
      >
        {t('taskList.viewAll')}
      </Button>
    </Flexbox>
  );
});

export default TaskListHeader;
