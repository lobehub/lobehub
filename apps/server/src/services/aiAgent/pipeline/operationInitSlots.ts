import type { OperationInitSlots } from '@/server/services/agentRuntime/AgentRuntimeService/operationInitSlots';

import type { OperationPrepResult } from './operationPrep';
import type { ToolDiscoveryResult } from './toolDiscovery';

/**
 * Read the state slots off what the init produced. Shared by the send path,
 * which hands them to `createOperation`, and by a deferred init, which writes
 * them into the state its operation was created with.
 *
 * Awaits the credential listing last, so the read overlaps with whatever ran
 * since discovery started it.
 */
export const resolveOperationInitSlots = async ({
  discovery,
  initialContext,
  prep,
}: {
  discovery: ToolDiscoveryResult;
  initialContext: OperationPrepResult['initialContext'];
  prep: OperationPrepResult;
}): Promise<OperationInitSlots> => {
  const { audio, video, vision } = discovery.modelMediaCapabilities;

  return {
    activeDeviceId: discovery.activeDeviceId,
    activeDeviceScope: discovery.activeDeviceScope,
    agentGroup: discovery.operationAgentGroup,
    // Run context the context engine injects into the system message —
    // carried on the operation like `expertise`, not on the agent config.
    connectorOwnershipNote: discovery.connectorOwnershipNote,
    deviceSystemInfo:
      Object.keys(prep.deviceSystemInfo).length > 0 ? prep.deviceSystemInfo : undefined,
    executionPlan: discovery.executionPlan,
    expertise: prep.expertise,
    initialContext,
    initialMessages: prep.allMessages,
    modelCapabilities: {
      mediaCapabilities: {
        ...(typeof audio === 'boolean' && { audio }),
        ...(typeof video === 'boolean' && { video }),
        ...(typeof vision === 'boolean' && { vision }),
      },
      // Read once during discovery: every LLM attempt of this run resolves its
      // parameters from here, so no step re-reads the bank, the user's model
      // row or the reasoning config — and none of them can change mid-run.
      modelFacts: discovery.modelFacts,
    },
    // Listed once during discovery: every step renders {{CREDS_LIST}} from
    // here instead of asking the Market API again.
    operationCredentials: await discovery.credentialFactsPromise,
    operationSkillSet: prep.operationSkillSet,
    projectInstructions: prep.projectInstructions,
    searchDecision: discovery.searchDecision,
    toolSet: {
      activatableToolIds: prep.activatableToolIds,
      enabledToolIds: discovery.toolsResult.enabledToolIds,
      executorMap: discovery.toolExecutorMap,
      manifestMap: discovery.toolManifestMap,
      sourceMap: discovery.toolSourceMap,
      tools: discovery.tools,
    },
    userMemory: prep.userMemory,
  };
};
