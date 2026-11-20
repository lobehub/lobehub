import { projectToolEndResult } from '@lobechat/tool-view-model';

/**
 * The only `stream_end` fields anything on this wire reads.
 *
 * `finalContent` is the one the gateway client applies (a reasoning-only answer
 * arrives as chunks and gets promoted into it, so the bubble would be empty
 * without it). `stepLabel` is a short display label carried alongside.
 *
 * Everything else the event publishes — `reasoning`, `toolsCalling`, `usage`,
 * `grounding`, `imageList` — already reached this client token by token as
 * `stream_chunk`, and lands again, canonically, with the message. No gateway
 * consumer reads them here: the store's `stream_end` case touches
 * `finalContent` alone, and the CLI's renders nothing from the payload. On a
 * sampled run they were 12 kB of a 14 kB event.
 *
 * An allowlist rather than a denylist, so a new field on the publish site has
 * to be looked at before it rides along.
 */
const STREAM_END_WIRE_FIELDS = ['finalContent', 'stepLabel'] as const;

const projectStreamEndData = (data: unknown): unknown => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const record = data as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const field of STREAM_END_WIRE_FIELDS) {
    if (field in record) projected[field] = record[field];
  }

  return projected;
};

/**
 * Reduce an event to what the gateway wire actually needs.
 *
 * Both cuts here rest on the same fact: this socket is not how a result reaches
 * the screen. The message is, through a read path that already projects it, so
 * an event repeating the payload is a second copy of it. `tool_end` carries a
 * tool's body and state (see `projectToolEndResult`); `stream_end` carries the
 * assistant's reasoning and tool calls, which also arrived as chunks.
 *
 * This is the transport seam on purpose. The shared stream-manager chokepoint
 * would also catch the Responses API and the CLI's `--verbose`, both of which
 * print what is dropped here.
 */
export const projectGatewayEventData = (data: unknown, eventType: unknown): unknown => {
  if (eventType === 'tool_end') return projectToolEndResult(data);
  if (eventType === 'stream_end') return projectStreamEndData(data);

  return data;
};

/**
 * Shape an event for delivery on ANOTHER op's channel (a group member's events
 * mirrored onto the supervisor's socket).
 *
 * The gateway DO ends its session on any `agent_runtime_end` it receives,
 * whichever op the event names — so a member's terminal, mirrored verbatim,
 * closed the supervisor's session and every later supervisor step (the resume
 * after the member barrier, its final reply) was never streamed. The mirrored
 * copy is renamed to the non-terminal `member_runtime_end`: the client's member
 * handler still retires that member's column on it, while the DO, which only
 * reacts to `agent_runtime_end`, keeps the supervisor session open. The
 * member's own channel still receives the real terminal.
 *
 * Only applied when the mirror target's client declared it handles the new
 * event (`acceptsMemberRuntimeEnd`) — see `GatewayStreamNotifier.mirrorPush`.
 */
export const toMirroredEvent = (event: Record<string, unknown>): Record<string, unknown> =>
  event.type === 'agent_runtime_end' ? { ...event, type: 'member_runtime_end' } : event;
