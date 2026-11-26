import { BlockedPageError } from './errorType';

/**
 * Challenge and block pages are a few lines of text. A longer body is a real page
 * that merely mentions one (an article about Cloudflare, a support thread), so the
 * checks below only apply up to this length.
 */
export const CHALLENGE_PAGE_MAX_LENGTH = 2000;

/** Page titles of anti-bot walls, lower-cased and without trailing dots. */
const CHALLENGE_TITLES = new Set([
  // Cloudflare (interstitial, zh-CN interstitial, block page)
  'just a moment',
  '请稍候',
  'attention required! | cloudflare',
  // Akamai
  'access denied',
  // PerimeterX / HUMAN
  'access to this page has been denied',
  // Imperva
  'pardon our interruption',
  // Amazon, Bloomberg
  'robot check',
  'are you a robot?',
]);

/** Body text of anti-bot walls, lower-cased. Needed when the provider drops or rewrites the title. */
const CHALLENGE_PHRASES = [
  'performing security verification',
  'verifying you are human',
  'verify you are human',
  'checking your browser before accessing',
  'checking if the site connection is secure',
  'enable javascript and cookies to continue',
  'needs to review the security of your connection',
  'sorry, you have been blocked',
  'made us think you were a bot',
  'unusual traffic from your computer network',
];

const TRAILING_TITLE_CHAR = /[\s.…]/;

/**
 * Titles come from untrusted pages, so the trailing dots are dropped by scanning
 * from the end: a `[\s.…]+$` regex backtracks quadratically on a long run of them.
 */
const normalizeTitle = (title: string) => {
  const lowered = title.toLowerCase();

  let end = lowered.length;
  while (end > 0 && TRAILING_TITLE_CHAR.test(lowered[end - 1])) end--;

  return lowered.slice(0, end).trimStart();
};

/**
 * Whether a fetched page is an anti-bot challenge / block page rather than the
 * document. Crawl providers answer such a page with a normal success response, so
 * it can only be recognized from the page itself.
 */
export const isChallengePage = ({
  content,
  title,
}: {
  content?: string;
  title?: string;
}): boolean => {
  if (content && content.length > CHALLENGE_PAGE_MAX_LENGTH) return false;

  if (title && CHALLENGE_TITLES.has(normalizeTitle(title))) return true;
  if (!content) return false;

  const body = content.toLowerCase();

  return CHALLENGE_PHRASES.some((phrase) => body.includes(phrase));
};

/**
 * Throw when the page is an anti-bot wall. Every impl calls this before it drops a
 * body under the minimum length: a wall is often that short, and a dropped page
 * never reaches the check in `Crawler.crawl`.
 */
export const assertNotChallengePage = (page: { content?: string; title?: string }) => {
  if (isChallengePage(page)) throw new BlockedPageError();
};
