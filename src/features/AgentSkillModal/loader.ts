import type { AgentSkillModalOptions } from '.';

const importAgentSkillModal = () => import('.');

let agentSkillModalPromise: ReturnType<typeof importAgentSkillModal> | undefined;

export const preloadAgentSkillModal = (): ReturnType<typeof importAgentSkillModal> =>
  (agentSkillModalPromise ??= importAgentSkillModal().catch((error) => {
    agentSkillModalPromise = undefined;
    throw error;
  }));

export const openAgentSkillModal = async (options: AgentSkillModalOptions) => {
  const { createAgentSkillModal } = await preloadAgentSkillModal();

  return createAgentSkillModal(options);
};
