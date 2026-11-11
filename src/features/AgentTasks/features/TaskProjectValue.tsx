import { cssVar, Icon, Text } from '@lobehub/ui';
import { FolderKanbanIcon } from 'lucide-react';
import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';

import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { useLoadedProjectList } from '@/store/project';

import { resolveTaskProjectDisplay } from './projectSelectorModel';

interface TaskProjectValueProps {
  /** Shown when no project is picked. */
  emptyLabel: string;
  fontSize?: number;
  iconSize: number;
  projectId?: string | null;
  textStyle?: CSSProperties;
  weight?: number;
}

/** The current project as icon + name, in the shape a picker trigger shows it. */
const TaskProjectValue = memo<TaskProjectValueProps>(
  ({ emptyLabel, fontSize, iconSize, projectId, textStyle, weight }) => {
    const { t } = useTranslation('chat');
    const projects = useLoadedProjectList();
    const display = resolveTaskProjectDisplay(projectId, projects);
    const style = { minWidth: 0, ...textStyle };

    if (display.kind === 'project')
      return (
        <>
          <ProjectAvatar
            avatar={display.project.avatar}
            name={display.project.name}
            size={iconSize}
          />
          <Text ellipsis fontSize={fontSize} style={style} weight={weight}>
            {display.project.name}
          </Text>
        </>
      );

    const labels = {
      none: emptyLabel,
      pending: t('taskProject.label'),
      unavailable: t('taskProject.unavailable'),
    };

    return (
      <>
        <Icon color={cssVar.colorTextDescription} icon={FolderKanbanIcon} size={iconSize} />
        <Text color={cssVar.colorTextDescription} fontSize={fontSize} style={style} weight={weight}>
          {labels[display.kind]}
        </Text>
      </>
    );
  },
);

TaskProjectValue.displayName = 'TaskProjectValue';

export default TaskProjectValue;
