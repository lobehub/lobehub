import * as stylex from '@stylexjs/stylex';

/**
 * Colors for an @-mention of a member: a blue-violet mixed from the theme's geekblue and purple
 * scales, so a mention never reads as the link blue next to it. The vars and their dark-mode
 * values live in `global.css`; the fallbacks are the light values.
 */
const BASE = 'color-mix(in srgb, var(--lobe-geekblue) 50%, var(--lobe-purple))';

export const mentionTokens = stylex.defineConsts({
  color: `var(--lobe-mention-color, ${BASE})`,
  bg: `var(--lobe-mention-bg, color-mix(in srgb, ${BASE} 14%, transparent))`,
  bgHover: `var(--lobe-mention-bg-hover, color-mix(in srgb, ${BASE} 22%, transparent))`,
});
