export type ScmEventKind = 'ci_failed' | 'review_changes_requested' | 'review_commented';

export interface ScmEventCheck {
  conclusion?: string;
  log?: string;
  name: string;
  url?: string;
}

export interface ScmEventReview {
  author: string;
  body: string;
  line?: number;
  path?: string;
  state?: string;
  url?: string;
}

export interface ScmEventAttributes {
  branch?: string;
  kind: ScmEventKind | string;
  number?: string;
  provider: string;
  repo?: string;
  sha?: string;
  url?: string;
}

export interface ParsedScmEvent {
  checks: ScmEventCheck[];
  instruction?: string;
  reviews: ScmEventReview[];
}

/**
 * A card link the renderer may turn into an anchor.
 *
 * The block is markdown a message author can write by hand, and on desktop
 * a click on an anchor reaches `shell.openExternal` — so an `scmEvent` with
 * a `vscode:` or `file:` url would launch an OS protocol handler. Only
 * http(s) survives parsing; anything else is dropped and the field renders
 * as plain text. Same rule as `openTrustedExternalUrl`, applied one layer
 * earlier so every consumer of the parsed event inherits it.
 */
export const safeScmUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const { protocol, href } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? href : undefined;
  } catch {
    return undefined;
  }
};

const unescapeAttribute = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

/** `key="value"` pairs of an open tag, values unescaped. */
export const parseAttributes = (raw: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    result[match[1]] = unescapeAttribute(match[2]);
  }
  return result;
};

/** The text of every CDATA section in `raw`, joined; plain text when there is none. */
const cdataText = (raw: string) => {
  const sections = [...raw.matchAll(/<!\[CDATA\[([\S\s]*?)\]\]>/g)].map((m) => m[1]);
  const text = sections.length > 0 ? sections.join('') : raw;
  return text.replace(/^\n/, '').replace(/\n$/, '');
};

/**
 * Parses the children of a `<scmEvent>` block emitted by the server's wake
 * prompt: `<check … />` or `<check …><log><![CDATA[…]]></log></check>`,
 * `<review …><![CDATA[…]]></review>` and `<instruction>…</instruction>`.
 * Tolerant by design — anything it does not recognise is ignored, never
 * thrown on, so a malformed block degrades to an empty card, not a crash.
 */
export const parseScmEvent = (raw: string): ParsedScmEvent => {
  const result: ParsedScmEvent = { checks: [], reviews: [] };
  if (!raw) return result;

  for (const match of raw.matchAll(/<check\b([^>]*?)(?:\/>|>([\S\s]*?)<\/check>)/g)) {
    const attrs = parseAttributes(match[1] ?? '');
    if (!attrs.name) continue;
    const logMatch = match[2] ? /<log>([\S\s]*?)<\/log>/.exec(match[2]) : null;
    result.checks.push({
      conclusion: attrs.conclusion,
      log: logMatch ? cdataText(logMatch[1]) : undefined,
      name: attrs.name,
      url: safeScmUrl(attrs.url),
    });
  }

  for (const match of raw.matchAll(/<review\b([^>]*)>([\S\s]*?)<\/review>/g)) {
    const attrs = parseAttributes(match[1] ?? '');
    const line = attrs.line ? Number(attrs.line) : undefined;
    result.reviews.push({
      author: attrs.author ?? 'unknown',
      body: cdataText(match[2]),
      line: Number.isFinite(line) ? line : undefined,
      path: attrs.path,
      state: attrs.state,
      url: safeScmUrl(attrs.url),
    });
  }

  const instruction = /<instruction>([\S\s]*?)<\/instruction>/.exec(raw);
  if (instruction) result.instruction = instruction[1].trim();

  return result;
};
