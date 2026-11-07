/**
 * `--origin-*` flags of `task create`: the conversation the server reports the
 * finished task back to. The server checks the caller owns that topic and agent.
 */
export interface TaskOriginOptions {
  originAgent?: string;
  originMessage?: string;
  originOperation?: string;
  originToolCall?: string;
  originTopic?: string;
}

export interface TaskOriginInput {
  agentId: string;
  messageId?: string;
  operationId?: string;
  toolCallId?: string;
  topicId: string;
}

/** `context.origin` for `task create`, or undefined when no origin flag is set. */
export const toCreateOrigin = (options: TaskOriginOptions): TaskOriginInput | undefined => {
  const agentId = options.originAgent?.trim();
  const topicId = options.originTopic?.trim();
  const messageId = options.originMessage?.trim();
  const operationId = options.originOperation?.trim();
  const toolCallId = options.originToolCall?.trim();

  if (!agentId && !topicId && !messageId && !operationId && !toolCallId) return undefined;
  // The server can only deliver the result with both: the card goes into the
  // topic and the agent is woken there.
  if (!agentId || !topicId) {
    throw new Error('--origin-agent and --origin-topic must be given together');
  }

  const origin: TaskOriginInput = { agentId, topicId };
  if (messageId) origin.messageId = messageId;
  if (operationId) origin.operationId = operationId;
  if (toolCallId) origin.toolCallId = toolCallId;
  return origin;
};
