import type { McpEventAttributes, McpEventItem, ParsedMcpEvent } from './parseMcpEvent';

export interface McpEventCardModel {
  /** Batch line: total events in the batch and how many of them are not listed. */
  count?: { omitted: number; total: number };
  /** The event type, shown as the card's pill. */
  eventName?: string;
  /** Rows for a batch; empty when the single event sits on the status line. */
  events: McpEventItem[];
  instruction?: string;
  /** Subscription-ended line, and whether it must name the event itself (nothing else does). */
  notice?: { kind: string; namesEvent: boolean; reason: string };
  /** Only the event pill: a block with neither events nor a notice. */
  onlyEventName: boolean;
  /** One event and nothing left out: it shares the status line with the pill. */
  single?: McpEventItem;
  /** The server may have dropped events before this batch. */
  truncated: boolean;
}

/**
 * What the event card shows, decided from the parsed block — kept apart from
 * the rendering so every arrangement is testable without a DOM:
 *
 * - one event: it sits on the status line next to the event pill;
 * - a batch: a count line (with how many were left out), then one row each;
 * - a subscription that ended: its own line, naming the event when no event
 *   rows do;
 * - a possible gap: its own line; the approved instruction closes the card.
 */
export const buildMcpEventCard = (
  attrs: Pick<McpEventAttributes, 'event' | 'truncated'>,
  parsed: ParsedMcpEvent,
): McpEventCardModel => {
  const { events, notice, omitted } = parsed;
  const total = events.length + omitted;
  const single = events.length === 1 && omitted === 0 ? events[0] : undefined;
  const eventName = attrs.event || undefined;

  return {
    count: !single && total > 0 ? { omitted, total } : undefined,
    eventName,
    events: single ? [] : events,
    instruction: parsed.instruction,
    notice: notice
      ? { kind: notice.kind, namesEvent: total === 0, reason: notice.reason ?? 'unknown' }
      : undefined,
    onlyEventName: total === 0 && !notice && !!eventName,
    single,
    truncated: attrs.truncated === 'true',
  };
};
