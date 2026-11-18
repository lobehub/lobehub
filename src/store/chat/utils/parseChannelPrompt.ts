/**
 * A Channel run's user message, written by the server's `buildChannelPrompt`: unseen context,
 * the quote, the request and the notes after it, each a `<channel_* boundary="…">` block whose
 * close tag carries the same per-run boundary. It is prompt markup, not something to show raw.
 */
export interface ChannelPromptMessage {
  /** Number of files the message carries. */
  attachments?: number;
  content: string;
  from: string;
  /** The author is the Agent the run belongs to. */
  self: boolean;
  /** Only an excerpt is in the prompt. */
  truncated: boolean;
  type?: string;
}

export interface ChannelPrompt {
  /** Notes to the model about other Agents asked or why it was woken. */
  notes: string[];
  /** Unseen messages before `recent` left out of the prompt. */
  omitted: number;
  /** The acknowledgement the Agent posted before starting. */
  opening?: string;
  quote?: ChannelPromptMessage;
  recent: ChannelPromptMessage[];
  /** Another participant's published answer to the same request. */
  reply?: ChannelPromptMessage;
  request: ChannelPromptMessage & { to?: string };
}

/** `key="value"` pairs of an open tag, unescaped as the server's `escapeAttribute` wrote them. */
const parseAttributes = (raw: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [, name, value] of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    result[name] = value
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  }
  return result;
};

const OPEN_RE = /^\s*<channel_\w+\b([^>]*)>/;
const OPENING_RE = /^You already posted this to the Channel before starting: "([\S\s]*)"\n/;

const toMessage = (attrs: Record<string, string>, content: string): ChannelPromptMessage => ({
  attachments: attrs.attachments ? Number(attrs.attachments) : undefined,
  content,
  from: attrs.from ?? '',
  self: attrs.self === 'true',
  truncated: attrs.truncated === 'true',
  type: attrs.type,
});

/**
 * The blocks of a Channel run's prompt, or undefined for any other message. Only a message that
 * opens with a boundary-tagged `channel_*` block and holds a `channel_request` counts; a block
 * is closed only by a tag carrying the run's boundary, so text a participant wrote cannot end it.
 */
export const parseChannelPrompt = (
  content: string | null | undefined,
): ChannelPrompt | undefined => {
  if (!content) return undefined;
  const open = OPEN_RE.exec(content);
  if (!open) return undefined;
  const boundary = parseAttributes(open[1] ?? '').boundary;
  if (!boundary || !/^\w+$/.test(boundary)) return undefined;

  const blockRe = new RegExp(
    String.raw`<(channel_\w+)\b([^>]*)>\n([\S\s]*?)\n</\1 boundary="${boundary}">`,
    'g',
  );
  const prompt: Omit<ChannelPrompt, 'request'> & { request?: ChannelPrompt['request'] } = {
    notes: [],
    omitted: 0,
    recent: [],
  };

  for (const [, tag, rawAttrs, body] of content.matchAll(blockRe)) {
    const attrs = parseAttributes(rawAttrs ?? '');
    if (attrs.boundary !== boundary) continue;
    switch (tag) {
      case 'channel_gap': {
        prompt.omitted = Number(attrs.omitted) || 0;
        break;
      }
      case 'channel_message': {
        prompt.recent.push(toMessage(attrs, body));
        break;
      }
      case 'channel_quote': {
        prompt.quote = toMessage(attrs, body);
        break;
      }
      case 'channel_request': {
        prompt.request = { ...toMessage(attrs, body), to: attrs.to };
        break;
      }
      case 'channel_reply': {
        prompt.reply = toMessage(attrs, body);
        break;
      }
      case 'channel_opening': {
        prompt.opening = OPENING_RE.exec(body)?.[1] ?? body;
        break;
      }
      default: {
        prompt.notes.push(body);
      }
    }
  }

  if (!prompt.request) return undefined;
  return prompt as ChannelPrompt;
};
