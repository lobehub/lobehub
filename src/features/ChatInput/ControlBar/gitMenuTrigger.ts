// oxlint-disable-next-line stylex-migration/no-emotion-styles -- the trigger restyles caller-provided chips it cannot pass props to
import { createStaticStyles } from '@lobehub/ui';

export const gitMenuTriggerStyles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    display: inline-flex;
    flex: none;
    min-width: 0;

    /* The stable menu anchor must not paint behind the child's rounded chip or
       overview row. Keep hover and popup-open feedback on that same surface. */
    &&&[data-popup-open] {
      background: transparent;
    }

    /* Child rules use !important: the chips inside are StyleX-styled, and StyleX
       longhands (raised specificity) would otherwise beat these selectors. */

    /* A column host stretches the anchor for overview rows; compact composer
       chips use their intrinsic width instead of 100% of the whole git group. */
    && > * {
      flex: 1 !important;
      min-width: 0 !important;
    }

    &[data-popup-open] > * {
      background: ${cssVar.colorFillTertiary} !important;
    }

    /* Stale-first: the trigger stays in place (no layout jump) but cannot
       checkout until the current probe confirms the branch. */
    &[aria-disabled='true'] > * {
      cursor: not-allowed !important;
      opacity: 0.6 !important;
    }
  `,
}));
