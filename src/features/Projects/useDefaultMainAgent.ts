import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

/** The main agent a new project starts with: the workspace inbox agent, LobeAI. */
export const useDefaultMainAgent = () =>
  useAgentStore(builtinAgentSelectors.inboxAgentId);
