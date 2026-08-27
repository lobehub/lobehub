// Imported via @lobechat/const (already a dependency) rather than
// @lobechat/business-const, which this package does not depend on.
import { BRANDING_NAME, DEFAULT_INBOX_TITLE, LOBE_CHAT_CLOUD } from '@lobechat/const';
import type { PostProcessorModule } from 'i18next';

/**
 * Upstream brand literals baked into the locale files, each paired with the
 * constant a white-label deployment overrides.
 *
 * Several hundred copy strings name the product or the default assistant inline
 * (`'Ask Lobe AI'`, `'Sign in to LobeHub'`, …) instead of interpolating a brand
 * variable, across ~18 locales. Rewriting the JSON per deployment would touch a
 * thousand tracked files and conflict on every upgrade, so white-label
 * deployments patch the strings as they are translated instead.
 *
 * ORDER MATTERS — entries are matched longest-first, so `LobeHub Cloud` has to
 * come before `LobeHub`, or a deployment that renamed the hosted service could
 * never see its own LOBE_CHAT_CLOUD in translated copy. A deployment that
 * renames only BRANDING_NAME drops the (now identity) Cloud pair and falls
 * through to the shorter rule, yielding `<brand> Cloud` — degraded, but still
 * not a leak.
 *
 * `LobeChat` is the pre-rename product name. It still appears in locales that
 * have not been retranslated since the rename (ja-JP, ko-KR, zh-TW, …), so a
 * deployment that rewrote only `LobeHub` would keep leaking it.
 */
const BRAND_LITERALS: [from: string, to: string][] = [
  ['LobeHub Cloud', LOBE_CHAT_CLOUD],
  ['LobeHub', BRANDING_NAME],
  ['LobeChat', BRANDING_NAME],
  ['Lobe AI', DEFAULT_INBOX_TITLE],
];

/** Only the literals this deployment actually renamed; identity pairs are noise. */
const replacements = BRAND_LITERALS.filter(([from, to]) => from !== to);

const lookup = new Map(replacements);

/**
 * Every literal above starts with this, which is what makes the pre-filter in
 * applyBrandStrings sound. Kept beside BRAND_LITERALS so the two cannot drift.
 */
const COMMON_PREFIX = 'Lobe';

/**
 * One alternation covering every active literal, rather than a replaceAll pass
 * per entry: this runs on every single t() call, so the work has to stay
 * proportional to the string rather than to the size of the table.
 *
 * The `from` values are the literals defined above — letters and spaces only —
 * so they need no regex escaping.
 *
 * `(?<!@)` leaves social handles such as `@LobeHub` alone (see the Slack copy in
 * messenger.json). A handle names an account that exists under the upstream
 * brand and has no counterpart in a white-label deployment, so rewriting it
 * would hand the user an address that does not resolve. Keeping the handle is
 * the honest failure mode; making it configurable is a separate upstream change.
 */
const pattern = replacements.length
  ? new RegExp(`(?<!@)(${replacements.map(([from]) => from).join('|')})`, 'g')
  : undefined;

export const isBrandPostProcessorEnabled = replacements.length > 0;

export const BRAND_POST_PROCESSOR = 'brandStrings';

/** Apply the brand rewrites to one translated string. */
export const applyBrandStrings = (value: string): string => {
  // Fast path: the overwhelming majority of translated strings never mention the
  // brand, and one substring scan is much cheaper than running the regex.
  if (!pattern || !value.includes(COMMON_PREFIX)) return value;

  return value.replaceAll(pattern, (match) => lookup.get(match) ?? match);
};

/**
 * Rewrite hardcoded brand strings in translated copy so white-label
 * deployments never surface the upstream product's names. A no-op (and never
 * registered) under default branding.
 */
export const brandPostProcessor: PostProcessorModule = {
  name: BRAND_POST_PROCESSOR,
  process: (value) => (typeof value === 'string' ? applyBrandStrings(value) : value),
  type: 'postProcessor',
};
