import { cssVar, Text } from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { projectListItemSelector, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const styles = stylex.create({
  chip: {
    display: 'inline-flex',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    gap: 4,
    alignItems: 'center',
    minWidth: 0,
    maxWidth: 140,
    height: 20,
    paddingInline: 6,
    borderWidth: 1,
    borderStyle: 'solid',
    // A translucent fill rather than a border token: those are opaque greys that
    // match the dark board card, while this stays visible on whichever row, card
    // or group header it sits on.
    borderColor: sxVar.colorFill,
    borderRadius: 6,
    lineHeight: 1,
  },
});

interface TaskProjectChipProps {
  projectId?: string | null;
}

/**
 * The project a task belongs to, for list rows, board cards and group headers.
 *
 * Reads one row of the cached project list through a narrow selector, so a
 * thousand rows cost no request and re-render only when their own project
 * changes; the page that hosts them keeps that list fresh (`useTaskProjectList`).
 * No project, or one outside the list (deleted, or private to someone else),
 * renders nothing: never a placeholder or a raw id.
 */
const TaskProjectChip = ({ projectId }: TaskProjectChipProps) => {
  const project = useProjectStore(projectListItemSelector(projectId));
  const enabled = useUserStore(labPreferSelectors.enableProjects);

  if (!enabled || !project) return null;

  return (
    <span data-testid={'task-project-chip'} title={project.name} {...stylex.props(styles.chip)}>
      <ProjectAvatar avatar={project.avatar} id={project.id} name={project.name} size={14} />
      {/* `type="secondary"` resolves to the tertiary text colour, under AA at 12px. */}
      <Text ellipsis color={cssVar.colorTextSecondary} fontSize={12}>
        {project.name}
      </Text>
    </span>
  );
};

export default TaskProjectChip;
