import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import type { MessagesEngineParams } from '@lobechat/context-engine';

import type { ContextSnapshot } from './types';
import { createVariableGenerators } from './variableGenerators';

const definedOnly = <T extends Record<string, unknown>>(record: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

/**
 * Turn a {@link ContextSnapshot} into the parameters the messages engine runs
 * on. Pure: the same snapshot always yields the same parameters, so hosts
 * differ only in how they assemble the snapshot.
 */
export const buildMessagesEngineParams = (snapshot: ContextSnapshot): MessagesEngineParams => {
  const { agent, fileContext, model, run, step, tools, variables, world } = snapshot;

  const enabledToolIds = tools?.enabledToolIds;
  // The page agent's system role is only meaningful while a page is being
  // edited; hide it unless the run enabled the tool explicitly.
  const disabledToolIdentifiers =
    tools?.disabledToolIdentifiers ??
    (enabledToolIds?.includes(PageAgentIdentifier) ? undefined : [PageAgentIdentifier]);

  return {
    // --- conversation + runtime flags ---
    additionalContexts: run.additionalContexts,
    enableAgentMode: run.enableAgentMode,
    enableExpertise: run.enableExpertise,
    expertise: run.expertise,
    forceFinish: run.forceFinish,
    formatHistorySummary: run.formatHistorySummary,
    historySummary: run.historySummary,
    initialContext: run.initialContext,
    messages: run.messages,
    stepContext: run.stepContext,

    // --- agent definition ---
    agentDocuments: agent.documents,
    agentIdentity: agent.identity,
    enableHistoryCount: agent.enableHistoryCount,
    historyCount: agent.historyCount,
    inputTemplate: agent.inputTemplate,
    knowledge: agent.knowledge,
    systemRole: agent.systemRole,

    // --- model ---
    capabilities: model.capabilities,
    model: model.model,
    modelDisplayName: model.displayName,
    modelKnowledgeCutoff: model.knowledgeCutoff,
    provider: model.provider,

    // --- tools + skills ---
    selectedSkills: tools?.selectedSkills,
    selectedTools: tools?.selectedTools,
    toolDiscoveryConfig: tools?.toolDiscoveryConfig,
    toolsConfig: {
      disabledToolIdentifiers,
      manifests: tools?.manifests,
      tools: enabledToolIds,
    },
    ...(tools?.enabledSkills?.length && { skillsConfig: { enabledSkills: tools.enabledSkills } }),

    // --- files + placeholders ---
    fileContext: fileContext ?? { enabled: true, includeFileUrl: true },
    variableGenerators: createVariableGenerators({
      model: model.model,
      provider: model.provider,
      timezone: world?.userTimezone,
      variables,
    }),
    timezone: world?.userTimezone,

    // --- world (frozen at creation) ---
    ...definedOnly({
      agentGroup: world?.group,
      botPlatformContext: world?.botPlatformContext,
      connectorOwnershipNote: world?.connectorOwnershipNote,
      discordContext: world?.discordContext,
      evalContext: world?.evalContext,
      projectInstructions: world?.projectInstructions,
      userMemory: world?.userMemory,
    }),

    // --- step facts (gathered per step) ---
    ...definedOnly({
      agentBuilderContext: step?.agentBuilderContext,
      agentManagementContext: step?.agentManagementContext,
      groupAgentBuilderContext: step?.groupAgentBuilderContext,
      onboardingContext: step?.onboardingContext,
      pageContentContext: step?.pageContentContext,
      planTodo: step?.planTodo,
      workspaceContext: step?.workspaceContext,
    }),
    ...(step?.topicReferences?.length && { topicReferences: step.topicReferences }),
  };
};
