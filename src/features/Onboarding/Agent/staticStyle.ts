import { createStaticStyles, keyframes } from 'antd-style';

const greetingTextEnter = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const completionSlideUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const staticStyle = createStaticStyles(({ css, cssVar }) => ({
  completionEnter: css`
    animation: ${completionSlideUp} 0.5s ease-out both;
  `,
  greetingTextAnimated: css`
    animation: ${greetingTextEnter} 400ms ease-out 500ms both;
  `,
}));
