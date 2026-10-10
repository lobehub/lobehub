import { createStaticStyles, cssVar } from '@lobehub/ui';

export const gitMenuTriggerStyles = createStaticStyles(({ css }) => ({
  trigger: css`
    display: inline-flex;
    flex: none;
    min-width: 0;

    /* The stable menu anchor must not paint behind the child's rounded chip or
       overview row. Keep hover and popup-open feedback on that same surface. */
    &&&[data-popup-open] {
      background: transparent;
    }

    /* A column host stretches the anchor for overview rows; compact composer
       chips use their intrinsic width instead of 100% of the whole git group. */
    && > * {
      flex: 1;
      min-width: 0;
    }

    &[data-popup-open] > * {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));
