import { Block } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ProjectSelector from './ProjectSelector';
import TaskProjectValue from './TaskProjectValue';

interface TaskProjectChipProps {
  onChange: (projectId: string | null) => void;
  value: string | null;
}

const CHIP_TEXT_STYLE = { maxWidth: 160 };

/** The task composers' project chip. */
const TaskProjectChip = memo<TaskProjectChipProps>(({ onChange, value }) => {
  const { t } = useTranslation('chat');

  return (
    <ProjectSelector value={value} onChange={onChange}>
      <Block
        clickable
        horizontal
        align="center"
        gap={6}
        height={24}
        paddingBlock={3}
        paddingInline={8}
        variant={'borderless'}
      >
        <TaskProjectValue
          emptyLabel={t('taskProject.label')}
          fontSize={12}
          iconSize={14}
          projectId={value}
          textStyle={CHIP_TEXT_STYLE}
        />
      </Block>
    </ProjectSelector>
  );
});

TaskProjectChip.displayName = 'TaskProjectChip';

export default TaskProjectChip;
