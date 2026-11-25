/** A message shows at most this many link cards, like Discord's embeds. */
export const MAX_LINK_PREVIEWS = 3;

const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const URL_PATTERN = /https?:\/\/[^\s"'()<>[\]`{}]+/gi;
/** Sentence punctuation and Markdown emphasis that follow a link are not part of it. */
const TRAILING_PUNCTUATION = /[!*,.:;?_~]+$/;

/**
 * The web addresses a message links, in order and without repeats, that can
 * get a card: links quoted inside code are text, not something being shared.
 * `skip` drops the ones another renderer already owns (internal app links).
 */
export const extractLinkPreviewUrls = (
  content: string,
  skip: (url: string) => boolean = () => false,
): string[] => {
  const prose = content.replaceAll(FENCED_CODE, '\n').replaceAll(INLINE_CODE, ' ');
  const urls: string[] = [];

  for (const [match] of prose.matchAll(URL_PATTERN)) {
    const candidate = match.replace(TRAILING_PUNCTUATION, '');
    let url: string;
    try {
      const parsed = new URL(candidate);
      if (!parsed.hostname.includes('.')) continue;
      parsed.hash = '';
      url = parsed.toString();
    } catch {
      continue;
    }
    if (urls.includes(url) || skip(url)) continue;
    urls.push(url);
    if (urls.length === MAX_LINK_PREVIEWS) break;
  }

  return urls;
};
