import { createStaticStyles, keyframes } from 'antd-style';

const greetingLogoEnter = keyframes`
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
`;

const greetingAvatarEnter = keyframes`
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const greetingTitleEnter = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

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
  greetingAvatarAnimated: css`
    animation: ${greetingAvatarEnter} 350ms ease-out 200ms both;
  `,
  greetingCard: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;
    background: ${cssVar.colorFillQuaternary};
  `,
  greetingLogo: css`
    filter: drop-shadow(0 4px 24px ${cssVar.colorPrimary}33);
    animation: ${greetingLogoEnter} 400ms ease-out both;
  `,
  greetingTextAnimated: css`
    animation: ${greetingTextEnter} 400ms ease-out 500ms both;
  `,
  greetingTitleAnimated: css`
    animation: ${greetingTitleEnter} 250ms ease 350ms both;
  `,
  composerZone: css`
    gap: 8px;
    margin-block-start: -8px;
  `,
  greetingAvatar: css`
    border-radius: 10px;
    box-shadow: 0 2px 12px ${cssVar.colorBgLayout};
  `,
  greetingDivider: css`
    width: 100%;
    margin-block: 4px;
  `,
  greetingText: css`
    font-size: 16px;
    line-height: 1.7;
    color: ${cssVar.colorText};
  `,
  greetingWrap: css`
    width: 100%;
    max-width: 640px;
  `,
  inlineQuestion: css`
    margin-block-start: 4px;
    padding-block-start: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  viewTransitionGreeting: css`
    ::view-transition-old(greeting-container) {
      animation: 350ms cubic-bezier(0.4, 0, 0.2, 1) both fade-out;
    }

    ::view-transition-new(greeting-container) {
      animation: 350ms cubic-bezier(0.4, 0, 0.2, 1) both fade-in;
    }

    @keyframes fade-out {
      from {
        transform: scale(1);
        opacity: 1;
      }

      to {
        transform: scale(0.97);
        opacity: 0;
      }
    }

    @keyframes fade-in {
      from {
        transform: scale(0.97);
        opacity: 0;
      }

      to {
        transform: scale(1);
        opacity: 1;
      }
    }
  `,
}));
