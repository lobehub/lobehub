import { type ParsedMcpEvent, parseMcpEvent } from '../McpEvent/parseMcpEvent';
import { parseXmlAttributes } from '../remarkPlugins/createRemarkXmlBlockPlugin';

/** Attributes of the `<webhookEvent>` open tag the server's wake prompt writes. */
export interface WebhookEventAttributes {
  /** The webhook's name as its owner set it; may be empty. */
  name?: string;
  /** The caller's thread key, when the call named one. */
  thread?: string;
  webhookId?: string;
}

export interface ParsedWebhookEvent extends ParsedMcpEvent {
  /** Ids of the events sent with "Send test" rather than by a caller. */
  testIds: Set<string>;
}

/**
 * The attributes of a wake-up message's `<webhookEvent>` block, or undefined for any other
 * message. Only a message that opens with the block counts, as for MCP events.
 */
export const getWebhookEventSource = (
  content: string | null | undefined,
): WebhookEventAttributes | undefined => {
  if (!content) return undefined;
  const open = /^\s*<webhookEvent\b([^>]*)>/.exec(content);
  if (!open) return undefined;
  return parseXmlAttributes(open[1] ?? '');
};

/**
 * The block's children share the MCP event layout (`<event id timestamp>`, `<omitted>`,
 * `<guidance>`, `<instruction>`), so they are read by the same tolerant parser; test deliveries
 * are flagged on top.
 */
export const parseWebhookEvent = (raw: string): ParsedWebhookEvent => {
  const testIds = new Set<string>();
  for (const match of (raw ?? '').matchAll(/<event\b([^>]*)>/g)) {
    const attrs = parseXmlAttributes(match[1] ?? '');
    if (attrs.test === 'true' && attrs.id) testIds.add(attrs.id);
  }
  return { ...parseMcpEvent(raw), testIds };
};
