import { type State } from '../../initialState';

const context = (s: State) => s.context;
const agentId = (s: State) => s.context.agentId;
const topicId = (s: State) => s.context.topicId;
const threadId = (s: State) => s.context.threadId;
const isThread = (s: State) => !!s.context.threadId;
const isTopic = (s: State) => !!s.context.topicId;

const hooks = (s: State) => s.hooks;
const hook = (hookName: keyof State['hooks']) => (s: State) => s.hooks[hookName];

export const contextSelectors = {
  agentId,
  context,
  hook,
  hooks,
  isThread,
  isTopic,
  threadId,
  topicId,
};
