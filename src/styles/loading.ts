import { textStyles } from '@lobehub/ui/base-ui';
import { createStaticStyles, css } from 'antd-style';

export const dotLoading = css`
  &::after {
    content: '\\2026'; /* ascii code for the ellipsis character */

    overflow: hidden;
    display: inline-block;

    width: 0;

    vertical-align: bottom;

    animation: ellipsis steps(4, end) 900ms infinite;
  }

  @keyframes ellipsis {
    to {
      width: 1.25em;
    }
  }

  @keyframes ellipsis {
    to {
      width: 1.25em;
    }
  }
`;

export const elapsedTimeStyles = createStaticStyles(({ css, cssVar }) => ({
  elapsedTime: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

export const errorTextStyles = createStaticStyles(({ css, cssVar }) => ({
  errorText: css`
    color: ${cssVar.colorError};
  `,
}));

export const shinyTextStyles = {
  errorText: errorTextStyles.errorText,
  shinyText: textStyles.shiny,
};
