import type { ChatMessageError } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

export interface ClientLlmWaitBody {
  expiresAt?: string;
  provider: string;
  waitingForClient: true;
}

/**
 * The assistant row of a run parked in `waiting_for_client`: the server could
 * not find a client to run an LLM call only the user's device can reach.
 */
export const readClientLlmWait = (
  error: ChatMessageError | null | undefined,
): ClientLlmWaitBody | undefined => {
  if (error?.type !== AgentRuntimeErrorType.ClientLlmExecutorUnavailable) return;
  const body = error.body as Partial<ClientLlmWaitBody> | undefined;
  if (body?.waitingForClient !== true || typeof body.provider !== 'string') return;
  return body as ClientLlmWaitBody;
};
