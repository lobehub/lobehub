import { z } from 'zod';

/**
 * The IM channel: a messaging-app view of one agent conversation.
 *
 * Unlike `/responses` (token stream) this surface is asynchronous and
 * whole-message: sending only acknowledges receipt, the agent works in the
 * background, and its replies become visible to `sync` only once they are
 * complete. Clients learn about progress from three facts — new whole messages,
 * whether the agent is "typing" (a run is in flight), and how far the agent has
 * read the user's messages.
 */

export const ImSendRequestSchema = z.object({
  /** The agent the user is talking to. */
  agentId: z.string().min(1),
  /**
   * Client-minted id for the user message (`msg_…`). Makes the send idempotent:
   * retrying with the same id returns the original receipt instead of starting
   * a second run.
   */
  clientMessageId: z
    .string()
    .regex(/^msg_[\w-]{8,64}$/, 'clientMessageId must look like msg_<8-64 url-safe chars>')
    .optional(),
  /** The message text. */
  content: z.string().trim().min(1).max(100_000),
  /** The conversation to continue; omit to start a new one for the agent. */
  topicId: z.string().min(1).nullish(),
});
export type ImSendRequest = z.infer<typeof ImSendRequestSchema>;

export const ImTopicParamSchema = z.object({
  topicId: z.string().min(1),
});
export type ImTopicParam = z.infer<typeof ImTopicParamSchema>;

/** Hard ceiling on a long-poll, comfortably below serverless request limits. */
export const IM_SYNC_MAX_WAIT_MS = 25_000;

export const ImSyncQuerySchema = z.object({
  /**
   * Opaque cursor returned by the previous `sync`; omit for the full history.
   * `<epoch micros>_<message id>` — the id breaks ties between rows written in
   * the same microsecond, which a timestamp-only cursor would skip.
   */
  cursor: z
    .string()
    .regex(/^\d+(_[\w-]{1,128})?$/, 'cursor must be the value returned by a previous sync')
    .optional(),
  /** Max messages to return when there is no cursor (latest N). */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /**
   * The `state` string from the previous response. A long-poll returns early
   * when the server's state differs (a new message, the agent started or stopped
   * typing, it read more, or the unread count moved).
   */
  state: z.string().max(200).optional(),
  /** Long-poll up to this many ms when nothing changed; 0 answers immediately. */
  waitMs: z.coerce.number().int().min(0).max(IM_SYNC_MAX_WAIT_MS).optional(),
});
export type ImSyncQuery = z.infer<typeof ImSyncQuerySchema>;

export const ImReadRequestSchema = z.object({
  /** The newest agent message the user has seen. */
  messageId: z.string().min(1),
});
export type ImReadRequest = z.infer<typeof ImReadRequestSchema>;

export interface ImMessage {
  content: string;
  createdAt: string;
  /** Set when the agent's turn failed; the client shows a retry affordance. */
  error: boolean;
  id: string;
  role: 'assistant' | 'user';
}

export interface ImSendResult {
  /** `false` when this was an idempotent retry of an already-received message. */
  accepted: boolean;
  /** The agent run that will answer; null on an idempotent retry. */
  operationId: string | null;
  topicId: string;
  userMessage: ImMessage;
}

export interface ImSyncResult {
  /** Pass back as `cursor` to receive only what is new. */
  cursor: string;
  /** Whole messages newer than the cursor, oldest first. */
  messages: ImMessage[];
  /** The newest user message the agent has picked up (the "read" receipt). */
  readUpTo: { messageId: string; readAt: string } | null;
  /** Pass back as `state` to long-poll for a change. */
  state: string;
  /** The agent is working on a reply ("typing…"). */
  typing: boolean;
  /** Agent messages newer than the user's read cursor. */
  unread: number;
}

export const PushTokenParamSchema = z.object({
  deviceId: z.string().min(1).max(200),
});
export type PushTokenParam = z.infer<typeof PushTokenParamSchema>;

export const PushTokenRegisterRequestSchema = z.object({
  appVersion: z.string().max(64).optional(),
  /** Expo push token, `ExponentPushToken[…]`. */
  expoToken: z.string().min(1).max(512),
  locale: z.string().max(32).optional(),
  platform: z.enum(['ios', 'android']),
});
export type PushTokenRegisterRequest = z.infer<typeof PushTokenRegisterRequestSchema>;

export const PushTokenUnregisterQuerySchema = z.object({
  /** The token being retired; scopes the delete to the row this device owns. */
  expoToken: z.string().min(1).max(512).optional(),
});
export type PushTokenUnregisterQuery = z.infer<typeof PushTokenUnregisterQuerySchema>;
