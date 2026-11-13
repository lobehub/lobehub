import { agentDisplayName } from '@lobechat/types';
import { Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import AgentAvatar from '@/components/AgentAvatar';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import type { ProjectListItem, ProjectOverview } from '@/store/project';

const AVATAR_SIZE = 18;

const styles = stylex.create({
  item: {
    borderRadius: '50%',
    // Separates overlapping avatars against the pocket glass.
    boxShadow: `0 0 0 1.5px ${cssVar.colorBgLayout}`,
    display: 'inline-flex',
    marginInlineStart: { ':first-child': 0, 'default': -6 },
  },
  root: {
    display: 'flex',
    flexShrink: 0,
  },
});

interface AgentStackProps {
  /** Members from the overview; until it loads, the main agent stands in. */
  agents?: ProjectOverview['agents'];
  project: ProjectListItem;
}

/** The project's agents, overlapped, the main agent first. */
export const AgentStack = ({ agents, project }: AgentStackProps) => {
  if (!agents?.length) {
    const { coordinatorAgent } = project;
    const label = coordinatorAgent ? agentDisplayName(coordinatorAgent) : undefined;
    return (
      <span {...stylex.props(styles.root)}>
        {coordinatorAgent && label ? (
          <Tooltip title={label}>
            <span {...stylex.props(styles.item)}>
              <AgentAvatar
                agentId={project.coordinatorAgentId}
                avatar={coordinatorAgent.avatar}
                background={coordinatorAgent.backgroundColor || cssVar.colorBgContainer}
                name={label}
                shape={'circle'}
                size={AVATAR_SIZE}
              />
            </span>
          </Tooltip>
        ) : (
          <AssigneeAvatar tooltip agentId={project.coordinatorAgentId} size={AVATAR_SIZE} />
        )}
      </span>
    );
  }

  return (
    <span {...stylex.props(styles.root)}>
      {agents.map((agent) => {
        const label = agentDisplayName(agent);
        return (
          <Tooltip key={agent.id} title={label}>
            <span {...stylex.props(styles.item)}>
              <AgentAvatar
                agentId={agent.id}
                avatar={agent.avatar}
                background={agent.backgroundColor || cssVar.colorBgContainer}
                name={label}
                shape={'circle'}
                size={AVATAR_SIZE}
              />
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
};
