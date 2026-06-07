import {
  AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER,
  AGENT_SIGNAL_SKILL_MANAGEMENT_TOOL_API_NAMES,
  AgentSignalToolExecutionRuntime,
} from '@lobechat/builtin-tool-agent-signal';

import { createResourceRuntimePrimitives } from '@/server/services/agentSignal/services/selfIteration/tools/runtimePrimitives';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import type { ServerRuntimeRegistration } from './types';

/**
 * Registers the same-turn skill-management builtin server runtime, so an
 * `execAgent` run with `plugins: ['agent-signal-skill-management']` can execute
 * its tools. The surface is skill-only (safe managed-skill reads + creates /
 * CAS replaces) — no memory, no proposal/idea recorders. Evidence is embedded in
 * the agent's prompt, so there is no collector.
 */
export const agentSignalSkillManagementRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { agentId, serverDB, userId } = context;
    if (!agentId || !userId || !serverDB) {
      throw new Error('agent-signal-skill-management requires agentId, userId and serverDB');
    }

    const service = createResourceRuntimePrimitives({
      agentId,
      db: serverDB,
      memoryReason: (count) =>
        `Agent Signal skill-management memory candidate from ${count} evidence refs.`,
      skillDocumentService: new SkillManagementDocumentService(serverDB, userId),
      userId,
    });

    return new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_SKILL_MANAGEMENT_TOOL_API_NAMES,
      service,
    });
  },
  identifier: AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER,
};
