/**
 * Social sharing for a public topic link.
 *
 * Every channel is built from the same {@link composeShareCopy} skeleton
 * (title — description · via LobeHub · link), so a post reads the same and
 * points at the same `/share/t/<id>` link whichever platform it lands on.
 *
 * - X (Twitter) and Weibo have web share intents: we open them in a new window.
 * - Instagram has no web intent and no prefill: we hand the text to the system
 *   share sheet when there is one (mobile), otherwise copy it to the clipboard.
 * - WeChat Moments can only be reached from the WeChat app: we render the link
 *   as a QR code to scan, next to a copy action.
 */

export type SocialPlatform = 'x' | 'weibo' | 'instagram' | 'wechat';

export const SOCIAL_PLATFORMS: SocialPlatform[] = ['x', 'weibo', 'instagram', 'wechat'];

/** Identifies LobeHub as the source on every channel. */
export const SHARE_SIGNATURE = 'via LobeHub';

export const TWITTER_INTENT_URL = 'https://twitter.com/intent/tweet';
export const WEIBO_SHARE_URL = 'https://service.weibo.com/share/share.php';
export const INSTAGRAM_URL = 'https://www.instagram.com/';

/** X caps a post at 280 weighted characters; every link counts as 23. */
export const TWITTER_MAX_WEIGHT = 280;
export const TWITTER_URL_WEIGHT = 23;

export interface SocialShareInput {
  description?: string;
  title: string;
  /** Public link of the shared content, e.g. `https://app.lobehub.com/share/t/<id>`. */
  url: string;
}

export interface ShareCopy {
  /** `title — description via LobeHub`, without the link (intents take the link separately). */
  text: string;
  /** {@link text} followed by the link on its own line, for clipboard / QR fallbacks. */
  textWithUrl: string;
  url: string;
}

const clean = (value?: string) => (value ?? '').replaceAll(/\s+/g, ' ').trim();

const joinText = (title: string, description: string) =>
  [[title, description].filter(Boolean).join(' — '), SHARE_SIGNATURE].filter(Boolean).join(' ');

export const composeShareCopy = ({ url, title, description }: SocialShareInput): ShareCopy => {
  const text = joinText(clean(title), clean(description));

  return { text, textWithUrl: `${text}\n${url}`, url };
};

/**
 * Weight of one code point in X's counting: Latin and common punctuation count
 * 1, everything else (CJK, emoji…) counts 2. Mirrors twitter-text's v3 config.
 */
const codePointWeight = (cp: number) =>
  cp <= 4351 ||
  (cp >= 8192 && cp <= 8205) ||
  (cp >= 8208 && cp <= 8223) ||
  (cp >= 8242 && cp <= 8247)
    ? 1
    : 2;

export const twitterTextWeight = (text: string) =>
  [...text].reduce((sum, char) => sum + codePointWeight(char.codePointAt(0)!), 0);

const ELLIPSIS = '…';

const truncateToWeight = (text: string, maxWeight: number) => {
  if (twitterTextWeight(text) <= maxWeight) return text;

  // Reserve the ellipsis at its real weight: X counts U+2026 as 2, not 1.
  let weight = twitterTextWeight(ELLIPSIS);
  let result = '';
  for (const char of text) {
    const next = weight + codePointWeight(char.codePointAt(0)!);
    if (next > maxWeight) break;
    weight = next;
    result += char;
  }

  return `${result.trimEnd()}${ELLIPSIS}`;
};

/**
 * Text for an X post that fits next to the link. The title / description are
 * shortened first so the signature always survives.
 */
export const buildTwitterText = (input: SocialShareInput) => {
  const { text } = composeShareCopy(input);
  // Link plus the space X puts in front of it.
  const budget = TWITTER_MAX_WEIGHT - TWITTER_URL_WEIGHT - 1;
  if (twitterTextWeight(text) <= budget) return text;

  const head = [clean(input.title), clean(input.description)].filter(Boolean).join(' — ');
  const suffix = ` ${SHARE_SIGNATURE}`;

  return `${truncateToWeight(head, budget - twitterTextWeight(suffix))}${suffix}`;
};

/**
 * Percent-encodes every value with `encodeURIComponent`. `URLSearchParams`
 * would write spaces as `+`, which Weibo's share page shows literally.
 */
const toQuery = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

export const buildTwitterShareUrl = (input: SocialShareInput) =>
  `${TWITTER_INTENT_URL}?${toQuery({ text: buildTwitterText(input), url: input.url })}`;

export const buildWeiboShareUrl = (input: SocialShareInput) => {
  const { text } = composeShareCopy(input);

  return `${WEIBO_SHARE_URL}?${toQuery({ title: text, url: input.url })}`;
};

export interface IntentShareAction<P extends 'x' | 'weibo'> {
  href: string;
  kind: 'intent';
  platform: P;
}

export interface ClipboardShareAction {
  copy: ShareCopy;
  kind: 'clipboard';
  openUrl: string;
  platform: 'instagram';
}

export interface QrCodeShareAction {
  copy: ShareCopy;
  kind: 'qrcode';
  platform: 'wechat';
  qrValue: string;
}

export interface SocialShareActions {
  instagram: ClipboardShareAction;
  wechat: QrCodeShareAction;
  weibo: IntentShareAction<'weibo'>;
  x: IntentShareAction<'x'>;
}

export type SocialShareAction = SocialShareActions[SocialPlatform];

/** One action per platform, all built from the same link and copy. */
export const buildSocialShareActions = (input: SocialShareInput): SocialShareActions => {
  const copy = composeShareCopy(input);

  return {
    instagram: { copy, kind: 'clipboard', openUrl: INSTAGRAM_URL, platform: 'instagram' },
    wechat: { copy, kind: 'qrcode', platform: 'wechat', qrValue: input.url },
    weibo: { href: buildWeiboShareUrl(input), kind: 'intent', platform: 'weibo' },
    x: { href: buildTwitterShareUrl(input), kind: 'intent', platform: 'x' },
  };
};

const SHARE_WINDOW_FEATURES = 'noopener,noreferrer,width=600,height=640';

/** Opens a share intent in a new window without handing it `window.opener`. */
export const openShareWindow = (href: string, win: Pick<Window, 'open'> = window) =>
  win.open(href, '_blank', SHARE_WINDOW_FEATURES);

export type InstagramShareResult = 'native' | 'copied' | 'cancelled';

interface InstagramShareDeps {
  copy: (text: string) => Promise<void>;
  navigator?: Partial<Pick<Navigator, 'share' | 'canShare'>>;
}

/**
 * Instagram cannot be prefilled from the web. Hand the post to the system share
 * sheet when the device has one (Instagram is a target there on mobile);
 * otherwise put the text on the clipboard for the user to paste.
 */
export const shareToInstagram = async (
  copy: ShareCopy,
  { copy: writeClipboard, navigator: nav }: InstagramShareDeps,
): Promise<InstagramShareResult> => {
  const data: ShareData = { text: copy.textWithUrl };

  if (nav?.share && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'native';
    } catch (error) {
      // Dismissing the sheet is a choice, not a failure.
      if ((error as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }

  await writeClipboard(copy.textWithUrl);
  return 'copied';
};
