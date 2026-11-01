/**
 * Feishu / Lark cloud-document links and message-content flattening.
 *
 * Two problems live here:
 *
 * 1. A document shared into a chat is a URL, not a body. Meeting minutes
 *    (智能纪要), wiki pages and docx files all arrive as
 *    `https://<tenant>.feishu.cn/docx/<token>`-style links; the token in
 *    that URL is what the Docs API wants. `parseLarkDocUrl` pulls it out.
 * 2. The receive event / history API hand us `content` as a JSON string
 *    whose shape depends on `message_type`. Only `text` is trivially a
 *    string — rich text (`post`) is a nested element tree, cards
 *    (`interactive`) are arbitrary JSON. `flattenLarkMessageContent`
 *    reduces every shape to "plain text + the links it carries" so
 *    callers do not need per-type knowledge to see a document link.
 */

export type LarkDocKind =
  'base' | 'doc' | 'docx' | 'file' | 'minutes' | 'sheets' | 'slides' | 'wiki';

export interface LarkDocLink {
  /** Host the link points at, e.g. `lobe-hub.feishu.cn`. */
  host: string;
  kind: LarkDocKind;
  /** Document / node token, e.g. `doxcnXXXX` for docx or the wiki node token. */
  token: string;
  /** The URL as it appeared, without query string or fragment. */
  url: string;
}

const DOC_HOST_PATTERN = String.raw`[\w-]+(?:\.[\w-]+)*\.(?:feishu\.cn|larksuite\.com|larkoffice\.com|feishu\.net)`;

/**
 * Path segments Feishu uses for cloud documents. `docs` is the legacy
 * "doc" product (kept distinct: it is NOT readable through the docx API),
 * `base` is Bitable. `space` is not a document path and is left out.
 */
const DOC_PATH_KINDS: Record<string, LarkDocKind> = {
  base: 'base',
  doc: 'doc',
  docs: 'doc',
  docx: 'docx',
  file: 'file',
  minutes: 'minutes',
  sheets: 'sheets',
  slides: 'slides',
  wiki: 'wiki',
};

const DOC_URL_RE = new RegExp(
  String.raw`https?://(${DOC_HOST_PATTERN})/(base|docs|doc|docx|file|minutes|sheets|slides|wiki)/([\w-]+)`,
  'gi',
);

/** Any http(s) URL — used to surface non-document links from cards / rich text. */
const ANY_URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

/**
 * Parse one Feishu / Lark cloud-document URL. Returns `undefined` for
 * anything that is not a document link on a Feishu / Lark host.
 */
export function parseLarkDocUrl(url: string): LarkDocLink | undefined {
  const trimmed = url.trim();
  const re = new RegExp(DOC_URL_RE.source, 'i');
  const match = re.exec(trimmed);
  if (!match || match.index !== 0) return undefined;

  const [matched, host, path, token] = match;
  const kind = DOC_PATH_KINDS[path.toLowerCase()];
  if (!kind) return undefined;

  return { host, kind, token, url: matched };
}

/**
 * Collect every distinct Feishu / Lark document link in a piece of text,
 * in order of first appearance.
 */
export function extractLarkDocLinks(text: string): LarkDocLink[] {
  const seen = new Set<string>();
  const links: LarkDocLink[] = [];
  for (const match of text.matchAll(DOC_URL_RE)) {
    const link = parseLarkDocUrl(match[0]);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
  }
  return links;
}

export interface FlattenedLarkContent {
  /** Feishu message image keys found in post nodes, in rich-text order. */
  imageKeys: string[];
  /** Every http(s) link found in the content, document links included, deduplicated. */
  links: string[];
  /** Plain-text rendering of the content; empty when nothing textual exists. */
  text: string;
}

const LINK_KEYS = new Set([
  'href',
  'url',
  'link',
  'pc_url',
  'android_url',
  'ios_url',
  'default_url',
]);
const TEXT_KEYS = new Set(['text', 'content', 'title', 'label', 'summary', 'file_name', 'name']);
// Excluding nested label openers and matching only native image destinations
// prevents repeated incomplete image markers from rescanning the remaining text.
const MARKDOWN_IMAGE_SCAN_RE =
  /(\\[\s\S]|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[^`\n]*`)|!\[[^[\]]*\]\((img_[\w-]+)(?:\s+["'][^"']*["'])?\)/g;

function pushUnique(list: string[], seen: Set<string>, value: string) {
  if (!value || seen.has(value)) return;
  seen.add(value);
  list.push(value);
}

function collectUrlsFromString(value: string, links: string[], seen: Set<string>) {
  for (const m of value.matchAll(ANY_URL_RE)) pushUnique(links, seen, m[0]);
}

function renderPostMarkdown(value: string, imageKeys: string[]): string {
  return value.replaceAll(MARKDOWN_IMAGE_SCAN_RE, (match, literal, imageKey) => {
    if (literal || !imageKey) return match;
    imageKeys.push(imageKey);
    // Native image keys are delivered as attachments, not browser image URLs.
    return '[image]';
  });
}

/**
 * Render one `post` element. Post content is `[[element, ...], ...]` — an
 * array of paragraphs, each an array of inline elements tagged
 * `text` / `a` / `at` / `img` / `media` / `emotion` / `code_block` / `hr`.
 */
function renderPostElement(
  el: any,
  links: string[],
  seen: Set<string>,
  imageKeys: string[],
): string {
  if (!el || typeof el !== 'object') return '';
  switch (el.tag) {
    case 'text': {
      return typeof el.text === 'string' ? el.text : '';
    }
    case 'a': {
      const href = typeof el.href === 'string' ? el.href : '';
      const label = typeof el.text === 'string' ? el.text : '';
      if (href) pushUnique(links, seen, href);
      if (href && label && label !== href) return `${label} (${href})`;
      return href || label;
    }
    case 'at': {
      // Mention placeholders are stripped by the adapter the same way text
      // mentions are; keep the display name so the sentence still reads.
      const name = typeof el.user_name === 'string' ? el.user_name : '';
      return name ? `@${name}` : '';
    }
    case 'code_block': {
      return typeof el.text === 'string' ? `\n${el.text}\n` : '';
    }
    case 'img': {
      if (typeof el.image_key === 'string' && el.image_key) imageKeys.push(el.image_key);
      return '[image]';
    }
    case 'md': {
      const text = typeof el.text === 'string' ? el.text : '';
      collectUrlsFromString(text, links, seen);
      return renderPostMarkdown(text, imageKeys);
    }
    case 'media': {
      return '[video]';
    }
    case 'emotion': {
      return typeof el.emoji_type === 'string' ? `[${el.emoji_type}]` : '';
    }
    default: {
      return typeof el.text === 'string' ? el.text : '';
    }
  }
}

function renderPost(content: any, links: string[], seen: Set<string>, imageKeys: string[]): string {
  // Receive events carry `{ title, content: [[...]] }`; outbound / some
  // history rows nest that under a locale key (`{ zh_cn: { title, content } }`).
  // Newer post bodies may provide `content_v2`; a non-empty v2 body wins.
  let post = content;
  const hasPostBody = (value: any) =>
    value &&
    typeof value === 'object' &&
    (Array.isArray(value.content) || Array.isArray(value.content_v2));

  if (post && typeof post === 'object' && !hasPostBody(post)) {
    const localized = Object.values(post).find((value: any) => hasPostBody(value));
    if (localized) post = localized;
  }
  if (!post || typeof post !== 'object') return '';

  const lines: string[] = [];
  if (typeof post.title === 'string' && post.title.trim()) lines.push(post.title.trim());

  const paragraphs: any[] =
    Array.isArray(post.content_v2) && post.content_v2.length > 0
      ? post.content_v2
      : Array.isArray(post.content)
        ? post.content
        : [];
  for (const paragraph of paragraphs) {
    const elements = Array.isArray(paragraph) ? paragraph : [paragraph];
    const line = elements.map((el) => renderPostElement(el, links, seen, imageKeys)).join('');
    lines.push(line.trim());
  }
  return lines.join('\n').trim();
}

/**
 * Generic walk for card JSON and any message type we have no schema for:
 * every string under a text-ish key becomes a line, every string under a
 * link-ish key (or containing a URL) contributes to `links`.
 */
function walkGeneric(
  node: any,
  lines: string[],
  links: string[],
  seen: Set<string>,
  depth = 0,
): void {
  if (depth > 12 || node === null || node === undefined) return;

  if (typeof node === 'string') {
    collectUrlsFromString(node, links, seen);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkGeneric(item, lines, links, seen, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      if (LINK_KEYS.has(key)) {
        if (/^https?:\/\//.test(value)) pushUnique(links, seen, value);
      } else if (TEXT_KEYS.has(key)) {
        const trimmed = value.trim();
        if (trimmed && !lines.includes(trimmed)) lines.push(trimmed);
        collectUrlsFromString(value, links, seen);
      } else {
        collectUrlsFromString(value, links, seen);
      }
    } else {
      walkGeneric(value, lines, links, seen, depth + 1);
    }
  }
}

/**
 * Reduce a Feishu / Lark message body to plain text plus the links it
 * carries. `content` may be the raw JSON string from the API or an
 * already-parsed object. Never throws: malformed content yields the raw
 * string as text (matching the previous `readMessages` fallback).
 */
export function flattenLarkMessageContent(
  messageType: string | undefined,
  content: unknown,
): FlattenedLarkContent {
  const links: string[] = [];
  const imageKeys: string[] = [];
  const seen = new Set<string>();

  let parsed: any = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      collectUrlsFromString(content, links, seen);
      return { imageKeys, links, text: content };
    }
  }

  let text: string;
  switch (messageType) {
    case 'text': {
      text = typeof parsed?.text === 'string' ? parsed.text : '';
      collectUrlsFromString(text, links, seen);
      break;
    }
    case 'post': {
      text = renderPost(parsed, links, seen, imageKeys);
      break;
    }
    case 'image':
    case 'file':
    case 'audio':
    case 'media':
    case 'sticker': {
      // Media bodies are handled by the attachment pipeline; a file name is
      // the only text worth surfacing.
      text = typeof parsed?.file_name === 'string' ? `[file] ${parsed.file_name}` : '';
      break;
    }
    default: {
      // `interactive` cards, share_* messages, system notices and anything
      // newer than this switch: harvest whatever text and links exist.
      const lines: string[] = [];
      walkGeneric(parsed, lines, links, seen);
      text = lines.join('\n');
    }
  }

  const missingLinks = links.filter((link) => !text.includes(link));
  if (missingLinks.length > 0) {
    text = `${text}\n[links: ${missingLinks.join(' ')}]`.trim();
  }

  return { imageKeys, links, text };
}
