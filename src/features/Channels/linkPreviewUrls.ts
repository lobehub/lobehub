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

/**
 * The web addresses a message links, in order and without repeats, that can
 * get a card. `skip` drops the ones another renderer already owns (internal
 * app links).
 */
export const extractLinkPreviewUrls = (
  content: string,
  skip: (url: string) => boolean = () => false,
): string[] => {
  const urls: string[] = [];

  visit(markdown.parse(content), 'link', (node: { url: string }) => {
    let url: string;
    try {
      const parsed = new URL(node.url);
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
