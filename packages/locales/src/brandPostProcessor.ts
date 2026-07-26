// Imported via @lobechat/const (already a dependency) rather than
// @lobechat/business-const, which this package does not depend on.
import { DEFAULT_INBOX_TITLE } from '@lobechat/const';
import type { PostProcessorModule } from 'i18next';

/** Upstream's default assistant name, as baked into the locale files. */
const UPSTREAM_INBOX_TITLE = 'Lobe AI';

/**
 * Literal → replacement map for brand strings baked into the locale files.
 *
 * A handful of copy strings name the default assistant inline (`'Lobe AI will
 * run this task…'`, `'Ask Lobe AI'`, …) instead of interpolating a brand
 * variable, across ~17 locales. Rewriting the JSON per deployment would touch
 * a hundred tracked files and conflict on every upgrade, so white-label
 * deployments patch the strings as they are translated instead.
 */
const replacements = ([[UPSTREAM_INBOX_TITLE, DEFAULT_INBOX_TITLE]] as [string, string][]).filter(
  ([from, to]) => from !== to,
);

export const isBrandPostProcessorEnabled = replacements.length > 0;

export const BRAND_POST_PROCESSOR = 'brandStrings';

/** Apply the brand rewrites to one translated string. */
export const applyBrandStrings = (value: string): string => {
  let output = value;
  for (const [from, to] of replacements) output = output.replaceAll(from, to);
  return output;
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
