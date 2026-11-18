import dayjs, { type Dayjs } from 'dayjs';

import { parseXmlAttributes, unescapeXmlText } from '../remarkPlugins/createRemarkXmlBlockPlugin';

/** Attributes of the `<mcpEvent>` open tag (契约 3.4). */
export interface McpEventAttributes {
  /** Connector identifier. */
  connector: string;
  connectorName?: string;
  /** Event type name. */
  event: string;
  /** `"true"` when the server may have dropped events before this batch. */
  truncated?: string;
  webhookId?: string;
}

export interface McpEventItem {
  /** The event's `data`, unescaped: single-line JSON from the server, but untrusted. */
  data: string;
  id: string;
  timestamp?: string;
}

export interface McpEventNotice {
  kind: string;
  reason?: string;
}

export interface ParsedMcpEvent {
  events: McpEventItem[];
  instruction?: string;
  notice?: McpEventNotice;
  /** Events in this batch that were not listed (over the 20-event cap). */
  omitted: number;
}

/** `key="value"` pairs of an open tag, values unescaped. */
export const parseAttributes = parseXmlAttributes;

/**
 * Element text as the server wrote it before escaping (契约 3.4 and 第 6 节:
 * `& < > "` plus `&#10;` for line breaks). See {@link unescapeXmlText}.
 */
export const unescapeText = unescapeXmlText;

/**
 * The attributes of a wake-up message's `<mcpEvent>` block, or undefined for
 * any other message. The user message shows the connector as its sender. The
 * server sends the block as the whole message, so only a message that opens
 * with it counts — a user quoting the tag mid-message keeps their identity.
 */
export const getMcpEventSource = (
  content: string | null | undefined,
): McpEventAttributes | undefined => {
  if (!content) return undefined;
  const open = /^\s*<mcpEvent\b([^>]*)>/.exec(content);
  if (!open) return undefined;
  const attrs = parseAttributes(open[1] ?? '');
  return {
    ...attrs,
    connector: attrs.connector ?? '',
    event: attrs.event ?? '',
  };
};

/** The sender name: the connector's display name, its identifier when the name is missing. */
export const mcpEventSenderName = (
  attrs: Pick<McpEventAttributes, 'connector' | 'connectorName'>,
) => attrs.connectorName?.trim() || attrs.connector;

/**
 * Parses the children of a `<mcpEvent>` block emitted by the server's wake
 * prompt: `<event id timestamp>json</event>`, `<omitted count />`,
 * `<notice kind reason />`, `<guidance>` (never shown) and `<instruction>`.
 *
 * The server escapes `& < >` in every payload, so event data cannot close a
 * tag or forge an `<instruction>`. The parser still reads the instruction from
 * the end of the block, after the last event, so even an unescaped payload
 * cannot replace the one the user approved. Tolerant by design: anything it
 * does not recognise is ignored, so a malformed block degrades to an empty
 * card rather than a crash.
 */
export const parseMcpEvent = (raw: string): ParsedMcpEvent => {
  const result: ParsedMcpEvent = { events: [], omitted: 0 };
  if (!raw) return result;

  // `<guidance>` is the fixed system note for the model; the user never sees it.
  const text = raw.replaceAll(/<guidance>[\S\s]*?<\/guidance>/g, '');

  let lastEventEnd = 0;
  for (const match of text.matchAll(/<event\b([^>]*)>([\S\s]*?)<\/event>/g)) {
    const attrs = parseAttributes(match[1] ?? '');
    lastEventEnd = (match.index ?? 0) + match[0].length;
    result.events.push({
      data: unescapeText(match[2].trim()),
      id: attrs.id ?? String(result.events.length + 1),
      timestamp: attrs.timestamp,
    });
  }

  const omitted = /<omitted\b([^>]*?)\/?>/.exec(text);
  if (omitted) {
    const count = Number(parseAttributes(omitted[1] ?? '').count);
    result.omitted = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  const notice = /<notice\b([^>]*?)\/?>/.exec(text);
  if (notice) {
    const attrs = parseAttributes(notice[1] ?? '');
    if (attrs.kind) result.notice = { kind: attrs.kind, reason: attrs.reason };
  }

  const tail = text.slice(lastEventEnd);
  const instructions = [...tail.matchAll(/<instruction>([\S\s]*?)<\/instruction>/g)];
  const instruction = instructions.at(-1)?.[1];
  if (instruction?.trim()) result.instruction = unescapeText(instruction.trim());

  return result;
};

/**
 * The event data for display: a one-line preview for the collapsed row and an
 * indented form for the expanded one. Data that is not JSON shows as written.
 */
export const formatEventData = (data: string): { preview: string; pretty: string } => {
  try {
    const parsed: unknown = JSON.parse(data);
    return { preview: JSON.stringify(parsed), pretty: JSON.stringify(parsed, null, 2) };
  } catch {
    return { preview: data.replaceAll(/\s+/g, ' '), pretty: data };
  }
};

/**
 * When an event happened: today's by time alone, older ones with their date,
 * since a busy topic can hold a batch until long after it arrived. A stamp
 * that does not parse shows as written.
 */
export const formatEventTime = (timestamp: string | undefined, now: Dayjs = dayjs()) => {
  if (!timestamp) return undefined;
  const time = dayjs(timestamp);
  if (!time.isValid()) return timestamp;
  // Seconds stay on other days too: events of one burst are seconds apart, and a card read the
  // next day would otherwise show the same minute on every row.
  return time.format(time.isSame(now, 'day') ? 'HH:mm:ss' : 'YYYY-MM-DD HH:mm:ss');
};
