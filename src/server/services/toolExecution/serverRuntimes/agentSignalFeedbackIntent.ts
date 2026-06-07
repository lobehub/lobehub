import {
  AGENT_SIGNAL_FEEDBACK_INTENT_IDENTIFIER,
  AGENT_SIGNAL_REFLECTION_TOOL_API_NAMES,
  AgentSignalToolExecutionRuntime,
} from '@lobechat/builtin-tool-agent-signal';

import { createResourceRuntimePrimitives } from '@/server/services/agentSignal/services/selfIteration/tools/runtimePrimitives';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import type { ServerRuntimeRegistration } from './types';

/**
 * Registers the self-feedback-intent builtin server runtime, so an `execAgent`
 * run with `plugins: ['agent-signal-feedback-intent']` can execute its tools.
 * It shares the reflection resource surface (safe skill reads / writes +
 * user-memory writes) plus the artifact recorders the package runtime echoes;
 * the distinct identifier keeps plugin routing and bookkeeping mode-specific.
 *
 * Not to be confused with the `declareSelfFeedbackIntent` fast-loop tool
 * ({@link ./selfFeedbackIntent}) a live agent calls to enqueue a source event —
 * this runtime backs the background agent that actions a declared intent.
 */
export const agentSignalFeedbackIntentRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { agentId, serverDB, userId } = context;
    if (!agentId || !userId || !serverDB) {
      throw new Error('agent-signal-feedback-intent requires agentId, userId and serverDB');
    }

    const service = createResourceRuntimePrimitives({
      agentId,
      db: serverDB,
      memoryReason: (count) =>
        `Agent Signal self-feedback intent memory candidate from ${count} evidence refs.`,
      skillDocumentService: new SkillManagementDocumentService(serverDB, userId),
      userId,
    });

    return new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REFLECTION_TOOL_API_NAMES,
      service,
    });
  },
  identifier: AGENT_SIGNAL_FEEDBACK_INTENT_IDENTIFIER,
};
