import type { ProjectDetail } from '@/store/project';

/**
 * The project's own Agents in the order its team reads them: the main agent first, then the
 * enabled members by their project sort order. A disabled member is still a candidate, just
 * not one the project put forward.
 */
export const projectAgentIds = (detail?: Pick<ProjectDetail, 'agents' | 'project'>): string[] => {
  if (!detail) return [];
  const mainAgentId = detail.project.coordinatorAgentId;
  const members = (detail.agents ?? [])
    .filter(({ agent, binding }) => binding.enabled && agent.id !== mainAgentId)
    .map(({ agent }) => agent.id);
  return mainAgentId ? [mainAgentId, ...members] : members;
};

/**
 * Splits picker candidates into the project's Agents (in `priorityIds` order) and everyone
 * else (in their original order), so a project Channel starts from its own team.
 */
export const splitByPriority = <T extends { id: string }>(
  candidates: T[],
  priorityIds: string[],
): { others: T[]; priority: T[] } => {
  const rank = new Map(priorityIds.map((id, index) => [id, index]));
  const priority = candidates
    .filter((candidate) => rank.has(candidate.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const others = candidates.filter((candidate) => !rank.has(candidate.id));
  return { others, priority };
};
