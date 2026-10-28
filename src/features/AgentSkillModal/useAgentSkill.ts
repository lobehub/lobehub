import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService } from '@/services/agentDocument';

/**
 * One managed skill of an agent, with its `SKILL.md`. `agentDocumentId` is the
 * skill bundle row or its `SKILL.md` index row. `data` is `null` once the skill
 * no longer exists for this agent.
 */
export const useAgentSkill = (agentId: string, agentDocumentId: string) =>
  useClientDataSWR(['agent-managed-skill', agentId, agentDocumentId], () =>
    agentDocumentService.getSkill({ agentDocumentId, agentId }),
  );
