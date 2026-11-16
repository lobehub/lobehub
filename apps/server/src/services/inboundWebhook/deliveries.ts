import type { InboundWebhookDeliveryItem, InboundWebhookDeliveryPage } from '@lobechat/types';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { signalDecisions, signals, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { getInboundWebhookKind } from './kinds';

export const DELIVERY_PAGE_SIZE = 20;
const PREVIEW_CHARS = 300;

/**
 * `created_at` as UTC ISO text with its microseconds. A JS `Date` keeps only milliseconds, so a
 * cursor built from one would skip the calls that share the boundary row's millisecond.
 */
const createdAtText = sql<string>`to_char(${signals.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** What the caller sent, compactly: the request body when the kind keeps one, else the payload. */
const previewOf = (payload: Record<string, unknown>) => {
  const shown = Object.hasOwn(payload, 'body') ? payload.body : payload;
  const text = typeof shown === 'string' ? shown : JSON.stringify(shown);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
};

/**
 * A webhook's deliveries, newest first, each with the Topic its run went to. Reads the signal
 * ledger the receiver writes (`scope_key = inbound-webhook:<id>`), which the
 * `(user_id, scope_key, source, created_at)` index serves.
 */
export async function listInboundWebhookDeliveries(
  db: LobeChatDatabase,
  row: InboundWebhookView,
  cursor?: { createdAt: string; id: string },
): Promise<InboundWebhookDeliveryPage> {
  const kind = getInboundWebhookKind(row.kind);
  if (!kind) return { items: [] };
  const cursorAt = cursor ? sql`${cursor.createdAt}::timestamptz` : undefined;
  const page = await db
    .select({
      createdAt: signals.createdAt,
      createdAtText,
      error: signals.error,
      id: signals.id,
      metadata: signals.metadata,
      occurredAt: signals.occurredAt,
      payload: signals.payload,
      payloadPurgedAt: signals.payloadPurgedAt,
      status: signals.status,
    })
    .from(signals)
    .where(
      and(
        eq(signals.userId, row.userId),
        eq(signals.scopeKey, `inbound-webhook:${row.id}`),
        eq(signals.source, kind.signalSource),
        cursorAt && cursor
          ? or(
              lt(signals.createdAt, cursorAt),
              and(eq(signals.createdAt, cursorAt), lt(signals.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(signals.createdAt), desc(signals.id))
    .limit(DELIVERY_PAGE_SIZE + 1);
  const rows = page.slice(0, DELIVERY_PAGE_SIZE);
  if (!rows.length) return { items: [] };

  // A signal gets one decision per wake attempt; the newest one says where it ended up.
  const decisions = await db
    .select({
      signalId: signalDecisions.signalId,
      topicId: signalDecisions.topicId,
      topicTitle: topics.title,
    })
    .from(signalDecisions)
    .leftJoin(topics, eq(topics.id, signalDecisions.topicId))
    .where(
      inArray(
        signalDecisions.signalId,
        rows.map((signal) => signal.id),
      ),
    )
    .orderBy(desc(signalDecisions.createdAt));
  const topicOf = new Map<string, { id: string; title: string | null }>();
  for (const decision of decisions) {
    if (decision.topicId && !topicOf.has(decision.signalId))
      topicOf.set(decision.signalId, { id: decision.topicId, title: decision.topicTitle ?? null });
  }

  const items = rows.map((signal): InboundWebhookDeliveryItem => ({
    id: signal.id,
    payloadPurged: !!signal.payloadPurgedAt,
    preview: signal.payloadPurgedAt ? null : previewOf(signal.payload),
    reason: signal.status === 'processed' ? null : signal.error,
    receivedAt: (signal.occurredAt ?? signal.createdAt).toISOString(),
    status: signal.status,
    test: signal.metadata.extra?.test === true,
    threadKey: signal.metadata.address?.threadKey ?? null,
    topic: topicOf.get(signal.id) ?? null,
  }));
  const last = rows.at(-1)!;
  return page.length > DELIVERY_PAGE_SIZE
    ? { items, nextCursor: { createdAt: last.createdAtText, id: last.id } }
    : { items };
}
