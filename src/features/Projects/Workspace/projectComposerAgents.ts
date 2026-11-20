import type { ProjectDetail } from '@/store/project';

export interface ProjectComposerAgent {
  avatar?: string | null;
  backgroundColor?: string | null;
  id: string;
  isMain: boolean;
  name?: string | null;
  title?: string | null;
}

/**
 * Who the project home composer can hand a message to: the project's main
 * agent first, then its enabled members. A main agent that fell back to LobeAI
 * has no member row, so it is listed by id alone and the caller fills in its
 * meta.
 */
export const projectComposerAgents = (
  detail: Pick<ProjectDetail, 'agents' | 'project'>,
): ProjectComposerAgent[] => {
  const mainAgentId = detail.project.coordinatorAgentId;
  const members = (detail.agents ?? [])
    .filter(({ agent, binding }) => binding.enabled || agent.id === mainAgentId)
    .map(({ agent }) => ({
      avatar: agent.avatar,
      backgroundColor: agent.backgroundColor,
      id: agent.id,
      isMain: agent.id === mainAgentId,
      name: agent.name,
      title: agent.title,
    }));
  const main = members.find((agent) => agent.isMain) ?? { id: mainAgentId, isMain: true };

  return [main, ...members.filter((agent) => !agent.isMain)];
};
