import { createStaticStyles, css, keyframes } from 'antd-style';

export const dotLoading = css`
  &::after {
    content: '\\2026';

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

const shine = keyframes`
  0% {
    background-position: 200%;
  }

  100% {
    background-position: -200%;
  }
`;

export const elapsedTimeStyles = createStaticStyles(({ css, cssVar }) => ({
  elapsedTime: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

export const shinyTextStyles = createStaticStyles(({ css, cssVar }) => ({
  shinyText: css`
    color: color-mix(in srgb, ${cssVar.colorText} 40%, transparent);

    background: linear-gradient(
      100deg,
      color-mix(in srgb, ${cssVar.colorTextBase} 0%, transparent) 45%,
      ${cssVar.colorTextQuaternary} 50%,
      color-mix(in srgb, ${cssVar.colorTextBase} 0%, transparent) 55%
    );
    background-clip: text;
    background-size: 200% 100%;

    animation: ${shine} 2s linear infinite;
  `,
}));
