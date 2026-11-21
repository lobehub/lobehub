import {
  parseXmlAttributes,
  unescapeXmlText,
} from '@/features/Conversation/Markdown/plugins/remarkPlugins/createRemarkXmlBlockPlugin';

/** Wake-up blocks whose events share the `<event …>data</event>` layout. */
const WAKE_UP_BLOCK = /^\s*<(webhookEvent|mcpEvent)\b([^>]*)>/;

/** What an event carried, in one line: a webhook's request body, or an MCP event's data. */
const eventText = (tag: string, data: string) => {
  try {
    const parsed: unknown = JSON.parse(data);
    const shown =
      tag === 'webhookEvent' && parsed && typeof parsed === 'object' && 'body' in parsed
        ? (parsed as { body: unknown }).body
        : parsed;
    return typeof shown === 'string' ? shown : JSON.stringify(shown);
  } catch {
    // The first message arrives sliced; a cut-off payload is shown as far as it goes.
    return data;
  }
};

/**
 * The preview of a topic's first message. A wake-up message (a webhook call or an MCP event) is
 * a machine-written block, so it reads as "who sent it: what it carried" instead of raw markup.
 * Any other message is returned as it is.
 */
export const topicPreviewText = (raw: string): string => {
  const open = WAKE_UP_BLOCK.exec(raw);
  if (!open) return raw;
  const [, tag, attributes] = open;
  const attrs = parseXmlAttributes(attributes ?? '');
  const sender = (
    tag === 'webhookEvent' ? attrs.name : attrs.connectorName || attrs.connector
  )?.trim();
  const rest = raw.slice(open[0].length);
  const event = /<event\b[^>]*>([\S\s]*?)(?:<\/event>|$)/.exec(rest);
  const text = event
    ? eventText(tag, unescapeXmlText(event[1].trim())).replaceAll(/\s+/g, ' ').trim()
    : '';
  return [sender, text].filter(Boolean).join(': ');
};
