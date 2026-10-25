import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import type { AgentGroupConfig } from '@lobechat/context-engine';
import debug from 'debug';
import type { ModelAbilities } from 'model-bank';

import { ChatGroupModel } from '@/database/models/chatGroup';

import {
  buildBotConversationGroupContext,
  buildGroupAgentContext,
} from '../../helpers/groupContext';
import {
  getMediaAvailabilityFromFileTypes,
  getMediaAvailabilityFromMessages,
  isMultimodalUnderstandingConfigured,
} from '../../helpers/mediaAvailability';
import type { ExecRunContext } from '../../types';
import type { ToolDiscoveryDeps, ToolDiscoveryInput } from './types';

const log = debug('lobe-server:ai-agent-service');

/**
 * Turn-scoped builtin tools to append to the candidate plugin ids: the IM
 * message tool for bot conversations, the task tool for a project coordinator
 * (it delegates by creating and assigning tasks), and multimodal understanding
 * when this turn or its history carries media the model cannot read itself.
 */
export const resolveTurnScopedPluginIds = async (params: {
  attachedFileTypes: string[];
  externalFileTypes?: string[];
  isBotConversation: boolean;
  isProjectCoordinator?: boolean;
  loadHistoryMessages: ToolDiscoveryInput['loadHistoryMessages'];
  modelMediaCapabilities: Pick<ModelAbilities, 'audio' | 'video' | 'vision'>;
}): Promise<string[]> => {
  const { isBotConversation, isProjectCoordinator, loadHistoryMessages, modelMediaCapabilities } =
    params;
  const externalFileTypes = params.externalFileTypes ?? [];
  const inputFileTypes = [...externalFileTypes, ...params.attachedFileTypes];
  const inputMediaAvailability = getMediaAvailabilityFromFileTypes(inputFileTypes);
  let historyMediaAvailability = { hasAudios: false, hasImages: false, hasVideos: false };
  const multimodalUnderstandingConfigured = isMultimodalUnderstandingConfigured();

  if (
    multimodalUnderstandingConfigured &&
    ((!modelMediaCapabilities?.audio && !inputMediaAvailability.hasAudios) ||
      (!modelMediaCapabilities?.vision && !inputMediaAvailability.hasImages) ||
      (!modelMediaCapabilities?.video && !inputMediaAvailability.hasVideos))
  ) {
    historyMediaAvailability = getMediaAvailabilityFromMessages(await loadHistoryMessages());
  }

  const needsAudioUnderstanding =
    (inputMediaAvailability.hasAudios || historyMediaAvailability.hasAudios) &&
    !modelMediaCapabilities?.audio;
  const needsImageUnderstanding =
    (inputMediaAvailability.hasImages || historyMediaAvailability.hasImages) &&
    !modelMediaCapabilities?.vision;
  const needsVideoUnderstanding =
    (inputMediaAvailability.hasVideos || historyMediaAvailability.hasVideos) &&
    !modelMediaCapabilities?.video;
  const shouldEnableMultimodalUnderstanding =
    multimodalUnderstandingConfigured &&
    (needsAudioUnderstanding || needsImageUnderstanding || needsVideoUnderstanding);

  return [
    ...(isBotConversation ? [MessageToolIdentifier] : []),
    ...(isProjectCoordinator ? [TaskIdentifier] : []),
    ...(shouldEnableMultimodalUnderstanding ? [LobeAgentManifest.identifier] : []),
  ];
};

/**
 * Resolve the operation's group context ONCE and snapshot it into op metadata
 * — the per-step context engine reads it back without a DB lookup, mirroring
 * agentConfig/botContext. The same roster fetch also authorizes the
 * group-orchestration toolset.
 */
export const resolveOperationGroup = async (
  deps: ToolDiscoveryDeps,
  ctx: Pick<ExecRunContext, 'agentConfig' | 'appContext' | 'resolvedAgentId'>,
  botContext: ToolDiscoveryInput['botContext'],
): Promise<{ isGroupSupervisor: boolean; operationAgentGroup?: AgentGroupConfig }> => {
  const { agentConfig, appContext, resolvedAgentId } = ctx;
  let isGroupSupervisor = false;
  let operationAgentGroup: AgentGroupConfig | undefined;
  if (appContext?.groupId) {
    const chatGroupModel = new ChatGroupModel(deps.db, deps.userId, deps.workspaceId);
    const [group, roster] = await Promise.all([
      chatGroupModel.findById(appContext.groupId),
      chatGroupModel.getGroupAgentsWithMeta(appContext.groupId),
    ]);

    // `appContext.orchestrationRole` is client-supplied (execGroupAgent stamps
    // it for whatever agentId the caller passed), so it must NOT alone
    // authorize the group-orchestration toolset — otherwise any run marked
    // `{ orchestrationRole: 'supervisor', groupId }` could dispatch members.
    // Verify against the persisted, ownership-scoped membership instead.
    if (appContext.orchestrationRole === 'supervisor') {
      isGroupSupervisor = roster.some(
        (member) => member.agentId === resolvedAgentId && member.role === 'supervisor',
      );
      if (!isGroupSupervisor)
        log(
          'execAgent: orchestrationRole=supervisor but agent %s is not the supervisor of group %s — denying group tools',
          resolvedAgentId,
          appContext.groupId,
        );
    }

    operationAgentGroup = buildGroupAgentContext(resolvedAgentId, group, roster);
  } else if (botContext) {
    operationAgentGroup = buildBotConversationGroupContext(resolvedAgentId, agentConfig);
  }
  return { isGroupSupervisor, operationAgentGroup };
};
