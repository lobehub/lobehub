import { textStyles } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';

const localTextGroupStyles = createStaticStyles(({ css }) => ({
  shinyGroup: css`
    @supports (-webkit-mask-clip: text) {
      & {
        --shiny-origin: static;

        position: relative;
      }
    }
  `,
}));

/**
 * Inspector text style — ellipsis + secondary color + flex align
 */
export const inspectorTextStyles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    /* Coordinate space for the shiny sweep: every shimmering span in the row
     * resolves its overlay against this box, so they read as one wave. */
    ${localTextGroupStyles.shinyGroup}

    overflow: hidden;
    display: flex;
    align-items: center;

    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/**
 * Highlight underline effect using gradient background
 */
export const highlightTextStyles = createStaticStyles(({ css, cssVar }) => {
  const highlightBase = (highlightColor: string) => css`
    overflow: hidden;

    min-width: 0;
    margin-inline-start: 4px;
    padding-block-end: 1px;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;

    background: linear-gradient(to top, ${highlightColor} 40%, transparent 40%);
  `;

  return {
    gold: highlightBase(cssVar.gold4),
    info: highlightBase(cssVar.colorInfoBg),
    primary: highlightBase(cssVar.colorPrimaryBgHover),
    warning: highlightBase(cssVar.colorWarningBg),
  };
});

/**
 * Shiny loading text animation, toned down to the secondary text color so a
 * shimmering label sits at the same visual weight as the static text next to it.
 */
const shinyToneStyles = createStaticStyles(({ css, cssVar }) => ({
  secondary: css`
    /* The upstream rest color is a 28% mix of --shiny-color, which reads far
     * weaker than the static labels next to it. Pin the rest color to the
     * neighbouring text color and let the sweep peak at full colorText. */
    &&& {
      --shiny-color: ${cssVar.colorText};

      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

export const shinyTextStyles = {
  shinyText: cx(textStyles.shiny, shinyToneStyles.secondary),
};

export const shinyGroupStyles = {
  shinyGroup: localTextGroupStyles.shinyGroup,
};
