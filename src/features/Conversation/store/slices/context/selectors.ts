import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type State } from '../../initialState';

const context = (s: State) => s.context;
const agentId = (s: State) => s.context.agentId;
const groupId = (s: State) => s.context.groupId;
const topicId = (s: State) => s.context.topicId;
const threadId = (s: State) => s.context.threadId;
const isThread = (s: State) => !!s.context.threadId;
const isTopic = (s: State) => !!s.context.topicId;
/** A read-only share-link view (topic share or shared-agent visitor), not the owner's own chat. */
const isSharePage = (s: State) => !!s.context.topicShareId || !!s.context.agentShareId;

const conversationKey = (s: State): string => {
  const { agentId, topicId, threadId, scope, isNew, groupId, subAgentId } = s.context;
  return messageMapKey({
    agentId,
    groupId,
    isNew,
    scope,
    subAgentId,
    threadId: threadId ?? undefined,
    topicId: topicId ?? undefined,
  });
};

const hooks = (s: State) => s.hooks;
const hook = (hookName: keyof State['hooks']) => (s: State) => s.hooks[hookName];

export const contextSelectors = {
  agentId,
  context,
  conversationKey,
  groupId,
  hook,
  hooks,
  isSharePage,
  isThread,
  isTopic,
  threadId,
  topicId,
};
