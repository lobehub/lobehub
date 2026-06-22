import { z } from 'zod';

/**
 * Serialized webhook config for an agent lifecycle hook — the wire shape
 * persisted on a running operation and delivered in queue mode.
 *
 * This is the transport view. The server's runtime `AgentHookWebhook` is a
 * richer superset (its `eventFields` is keyed to `AgentHookEvent`); reading a
 * persisted hook back casts up to it.
 */
export const agentHookWebhookSchema = z.object({
  body: z.record(z.unknown()).optional(),
  delivery: z.enum(['fetch', 'qstash']).optional(),
  eventFields: z.array(z.string()).optional(),
  url: z.string(),
});

/**
 * Serialized agent lifecycle hook (onComplete / onError / …). Only hooks
 * carrying a webhook are serializable — handler closures can't cross a process
 * boundary — so this is what gets persisted (e.g. on
 * `topic.metadata.runningOperation.hooks`) and replayed through the shared
 * hookDispatcher by every terminal site.
 */
export const serializedAgentHookSchema = z.object({
  id: z.string(),
  type: z.string(),
  webhook: agentHookWebhookSchema,
});

export type AgentHookWebhookConfig = z.infer<typeof agentHookWebhookSchema>;
export type SerializedAgentHook = z.infer<typeof serializedAgentHookSchema>;
