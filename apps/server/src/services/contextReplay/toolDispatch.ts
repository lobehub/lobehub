import { builtinTools } from '@lobechat/builtin-tools';
import { assertToolDispatchPolicy, isDeviceToolIdentifier } from '@lobechat/mecha';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { assertCanUseConversationTargets } from '@/server/routers/lambda/_helpers/conversationResourceGuard';

interface ToolPolicyContext {
  agentId: string;
  db: LobeChatDatabase;
  includeShareVisitor?: boolean;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

const loadPolicy = async (input: ToolPolicyContext) => {
  await assertCanUseConversationTargets(input, [{ agentId: input.agentId }]);
  const [policy, topic] = await Promise.all([
    new AgentModel(input.db, input.userId, input.workspaceId).getAgentToolPolicy(input.agentId),
    input.topicId
      ? new TopicModel(input.db, input.userId, input.workspaceId, undefined, {
          includeShareVisitor: input.includeShareVisitor,
        }).findById(input.topicId)
      : undefined,
  ]);
  if (!policy || (input.topicId && !topic)) throw new Error('Conversation is no longer available');
  return { policy, topic };
};
const bindingOf = ({ policy, topic }: Awaited<ReturnType<typeof loadPolicy>>) => ({
  topicDeviceId: topic?.metadata?.boundDeviceId ?? null,
  agentDeviceId: policy.agencyConfig?.boundDeviceId ?? null,
});
export const getCurrentExecutionBinding = async (input: ToolPolicyContext) =>
  bindingOf(await loadPolicy(input));

export const assertCurrentToolDispatch = async (
  input: ToolPolicyContext & {
    apiName: string;
    assistantMessageId?: string;
    expectedDeviceId?: string;
    identifier: string;
  },
) => {
  const loaded = await loadPolicy(input);
  const { policy, topic } = loaded;
  const model = new MessageModel(input.db, input.userId, input.workspaceId, undefined, {
    includeShareVisitor: input.includeShareVisitor,
  });
  const snapshot = input.assistantMessageId
    ? (await model.getContextReplays([input.assistantMessageId]))[input.assistantMessageId]
    : undefined;
  if (snapshot) {
    const assistant = await model.findById(input.assistantMessageId!);
    if (
      !assistant ||
      assistant.role !== 'assistant' ||
      (assistant.topicId ?? undefined) !== input.topicId ||
      (assistant.agentId && assistant.agentId !== input.agentId)
    )
      throw new Error('Execution context belongs to another conversation');
  }
  const dependent =
    isDeviceToolIdentifier(input.identifier) ||
    (input.identifier === 'lobe-skills' &&
      ['execScript', 'runCommand', 'exportFile'].includes(input.apiName) &&
      !!input.expectedDeviceId);
  if (dependent && !snapshot?.executionBinding)
    throw new Error('Execution device binding is unavailable; start a new call');
  assertToolDispatchPolicy({
    ...input,
    chatConfig: policy.chatConfig,
    executionTarget: policy.agencyConfig?.executionTarget,
    plugins: policy.plugins ?? undefined,
    conversationMode: topic?.metadata?.conversationMode,
    currentDeviceId: topic?.metadata?.boundDeviceId ?? policy.agencyConfig?.boundDeviceId,
    currentBinding: bindingOf(loaded),
    expectedBinding: snapshot?.executionBinding,
    manifest: builtinTools.find((tool) => tool.identifier === input.identifier)?.manifest,
  });
};
