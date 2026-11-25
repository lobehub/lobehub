import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { EXIT, visit } from 'unist-util-visit';

/** A message shows at most this many link cards, like Discord's embeds. */
export const MAX_LINK_PREVIEWS = 3;

// The same GFM parse the message renderer runs, so a card previews exactly the
// address its link opens: trailing punctuation, balanced parentheses and
// characters such as `_` at the end follow the autolink rules, and links
// quoted inside code are text, not links.
const markdown = unified().use(remarkParse).use(remarkGfm);

const WEB_ADDRESS = /https?:\/\//i;

/**
 * Cheap check before the Markdown parse: a message that never writes a web
 * address cannot link one. A link may still be inside code, so a `true` here
 * only means "worth parsing".
 */
export const mayLinkWebPage = (content: string) => WEB_ADDRESS.test(content);

interface LinkNode {
  identifier?: string;
  type: string;
  url?: string;
}

/**
 * The web addresses a message links, in order and without repeats, that can
 * get a card. `skip` drops the ones another renderer already owns (internal
 * app links).
 */
export const extractLinkPreviewUrls = (
  content: string,
  skip: (url: string) => boolean = () => false,
): string[] => {
  if (!mayLinkWebPage(content)) return [];

  const tree = markdown.parse(content);
  // `[docs][site]` renders as a link through `[site]: https://…`, defined anywhere in the text.
  const definitions = new Map<string, string>();
  visit(tree, 'definition', (node: LinkNode) => {
    if (node.identifier && node.url && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
  });

  const urls: string[] = [];
  visit(tree, (node: LinkNode) => {
    const href =
      node.type === 'link'
        ? node.url
        : node.type === 'linkReference' && node.identifier
          ? definitions.get(node.identifier)
          : undefined;
    if (!href) return;

    let url: string;
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
      if (!parsed.hostname.includes('.')) return;
      parsed.hash = '';
      url = parsed.toString();
    } catch {
      return;
    }
    if (urls.includes(url) || skip(url)) return;
    urls.push(url);
    if (urls.length === MAX_LINK_PREVIEWS) return EXIT;
  });

  return urls;
};
