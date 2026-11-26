import type { InboundWebhookKind } from '@lobechat/types';

import { genericKind } from './generic';
import { mcpEventsKind } from './mcpEvents';
import type { InboundWebhookKindHandler } from './types';

const kinds: { [K in InboundWebhookKind]: InboundWebhookKindHandler<K> } = {
  generic: genericKind,
  mcp_events: mcpEventsKind,
};

/**
 * The handler of a row's kind. Widened to accept any row: each handler is stored under its own
 * kind and callers look it up by `row.kind`, so it only ever receives rows of that kind.
 */
export const getInboundWebhookKind = (kind: string): InboundWebhookKindHandler | undefined =>
  Object.hasOwn(kinds, kind)
    ? (kinds[kind as InboundWebhookKind] as unknown as InboundWebhookKindHandler)
    : undefined;

/**
 * A per-pass cache of "is this row's kind switched on for its owner", so a sweep over many rows
 * reads each owner's flags once per kind. An unknown kind is off.
 */
export const createKindGate = () => {
  const cache = new Map<string, Promise<boolean>>();
  return (row: { kind: string; userId: string }) => {
    const key = `${row.kind}\u0000${row.userId}`;
    let enabled = cache.get(key);
    if (!enabled) {
      enabled = getInboundWebhookKind(row.kind)?.isEnabled(row.userId) ?? Promise.resolve(false);
      cache.set(key, enabled);
    }
    return enabled;
  };
};

/** `signals.source` of every kind, for sweeps that look across all of them. */
export const INBOUND_WEBHOOK_SIGNAL_SOURCES = Object.values(kinds).map((kind) => kind.signalSource);

export type { InboundWebhookContext, InboundWebhookKindHandler } from './types';
