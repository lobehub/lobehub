// Fixture: the stop handler runs once per user click, and the list handler
// returns every row it reads to the client.
import type { MessageModel, OperationService } from './types';

export async function stopOperation(
  deps: { messageModel: MessageModel; operations: OperationService },
  operationId: string,
  topicId: string,
) {
  await deps.operations.interrupt(operationId);
  const messages = await deps.messageModel.query({ topicId });
  const pending = messages.filter((m) => m.role === 'tool' && !m.content);
  await deps.messageModel.markAborted(pending.map((m) => m.id));
}

export async function listTopicMessages(deps: { messageModel: MessageModel }, topicId: string) {
  return deps.messageModel.query({ pageSize: 9999, topicId });
}
