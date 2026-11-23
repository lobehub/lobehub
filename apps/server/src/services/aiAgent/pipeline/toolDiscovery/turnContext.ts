import { ArtboardIdentifier } from '@lobechat/builtin-tool-artboard';
import { GoalIdentifier, hasUnfinishedGoalProposal } from '@lobechat/builtin-tool-goal';
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

const AGENT_MANAGEMENT_IDENTIFIER = 'lobe-agent-management';
const SERIALIZED_AGENT_MENTION_RE =
  /<mention\b[^>]*\bid=["']?(?:agt_|market:)[^"'\s/>]+["']?[^>]*\/>/;

const extractEditorTurnToolIds = (
  node: unknown,
  includeAgentMentions: boolean,
  out: string[],
): void => {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (
    record.type === 'action-tag' &&
    record.actionCategory === 'tool' &&
    typeof record.actionType === 'string' &&
    record.actionType.length > 0
  ) {
    out.push(record.actionType);
  }
  if (
    includeAgentMentions &&
    record.type === 'mention' &&
    record.metadata &&
    typeof record.metadata === 'object' &&
    (record.metadata as Record<string, unknown>).type === 'agent' &&
    typeof (record.metadata as Record<string, unknown>).id === 'string' &&
    ((record.metadata as Record<string, unknown>).id as string).length > 0
  ) {
    out.push(AGENT_MANAGEMENT_IDENTIFIER);
  }
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      extractEditorTurnToolIds(child, includeAgentMentions, out);
    }
  }
};

export interface HistoryTurnSelectionMessage {
  agentId?: string | null;
  compressedMessages?: ReadonlyArray<HistoryTurnSelectionMessage> | null;
  content?: unknown;
  editorData?: Record<string, any> | null;
  metadata?: {
    botSender?: unknown;
    externalOrigin?: unknown;
    selectedToolIds?: unknown;
  } | null;
  role: string;
}

/**
 * The tools the user selected or triggered via @-mentions anywhere in this
 * topic so far: earlier user turns' persisted `metadata.selectedToolIds`
 * (falling back to composer `editorData` action tags / agent mentions and
 * serialized `<mention id="agt_..." />` tags for legacy rows), plus this
 * turn's selection. Deduplicated, in first-selected order.
 *
 * Keeping turn-selected tools in the operation's initial invocation set on
 * follow-up turns preserves the system prompt and `<available_tools>` prefix
 * across turns, avoiding prompt-cache invalidation and `tool_name_unresolved`
 * when the model continues calling a tool it already used in an earlier turn.
 */
export const collectSelectedToolIds = (
  historyMessages: ReadonlyArray<HistoryTurnSelectionMessage>,
  current: readonly string[] = [],
  options?: {
    hasMentionedAgents?: boolean;
    isGroupConversation?: boolean;
    /**
     * An in-group member turn (`orchestrationRole === 'member'` without an
     * isolated `threadId`) shares the group topic's history but is prompted by
     * an ephemeral supervisor instruction, so it must not inherit the group
     * supervisor's @-mentioned tools from the shared topic.
     */
    isInGroupMember?: boolean;
    resolvedAgentId?: string;
  },
): string[] => {
  const includeAgentMentions = !options?.isGroupConversation;
  const ids: string[] = [];

  const visitMessage = (message: HistoryTurnSelectionMessage) => {
    if (Array.isArray(message.compressedMessages)) {
      for (const member of message.compressedMessages) {
        if (member && typeof member === 'object') visitMessage(member);
      }
    }
    if (message.role !== 'user') return;
    if (message.metadata?.botSender || message.metadata?.externalOrigin) return;
    if (
      options?.resolvedAgentId &&
      typeof message.agentId === 'string' &&
      message.agentId.length > 0 &&
      message.agentId !== options.resolvedAgentId
    ) {
      return;
    }

    const persisted = message.metadata?.selectedToolIds;
    if (Array.isArray(persisted)) {
      for (const id of persisted) {
        if (typeof id === 'string' && id.length > 0) ids.push(id);
      }
    }
    if (message.editorData && typeof message.editorData === 'object') {
      extractEditorTurnToolIds(
        (message.editorData as Record<string, unknown>).root,
        includeAgentMentions,
        ids,
      );
    }
    if (
      includeAgentMentions &&
      typeof message.content === 'string' &&
      SERIALIZED_AGENT_MENTION_RE.test(message.content)
    ) {
      ids.push(AGENT_MANAGEMENT_IDENTIFIER);
    }
  };

  if (!options?.isInGroupMember) {
    for (const message of historyMessages) {
      visitMessage(message);
    }
  }

  return [
    ...new Set([
      ...ids,
      ...current.filter((id): id is string => typeof id === 'string' && id.length > 0),
      ...(includeAgentMentions && options?.hasMentionedAgents ? [AGENT_MANAGEMENT_IDENTIFIER] : []),
    ]),
  ];
};

/**
 * Turn-scoped builtin tools to append to the candidate plugin ids: the IM
 * message tool for bot conversations, the task tool for a project coordinator
 * (it delegates by creating and assigning tasks), and multimodal understanding
 * when this turn or its history carries media the model cannot read itself,
 * and the goal tool while the conversation's latest goal proposal has not
 * created a goal (rejected with feedback, pending, or failed), so the resumed
 * turn or a plain "try again" can revise and resubmit it without `/goal`.
 * The artboard tool belongs to project conversations only; this server-side
 * discovery is its only way in, since it has no client executor.
 */
export const resolveTurnScopedPluginIds = async (params: {
  attachedFileTypes: string[];
  externalFileTypes?: string[];
  isBotConversation: boolean;
  isProjectConversation?: boolean;
  isProjectCoordinator?: boolean;
  loadHistoryMessages: ToolDiscoveryInput['loadHistoryMessages'];
  modelMediaCapabilities: Pick<ModelAbilities, 'audio' | 'video' | 'vision'>;
}): Promise<string[]> => {
  const {
    isBotConversation,
    isProjectConversation,
    isProjectCoordinator,
    loadHistoryMessages,
    modelMediaCapabilities,
  } = params;
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

  const continuesGoalProposal = hasUnfinishedGoalProposal(await loadHistoryMessages());

  return [
    ...(isBotConversation ? [MessageToolIdentifier] : []),
    ...(continuesGoalProposal ? [GoalIdentifier] : []),
    ...(isProjectCoordinator ? [TaskIdentifier] : []),
    ...(isProjectConversation ? [ArtboardIdentifier] : []),
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
