import { createStaticStyles, keyframes } from 'antd-style';

const slideDown = keyframes`
  from {
    transform: translateY(-20px) scale(0.96);
    opacity: 0;
  }

  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
`;

const fadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`;

const slideUp = keyframes`
  from {
    transform: translateY(0) scale(1);
    opacity: 1;
  }

  to {
    transform: translateY(-20px) scale(0.96);
    opacity: 0;
  }
`;

const fadeOut = keyframes`
  from {
    opacity: 1;
  }

  to {
    opacity: 0;
  }
`;

const pulse = keyframes`
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
`;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  backTag: css`
    cursor: pointer;
    font-size: 12px;
  `,
  chatContainer: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  `,
  chatMessage: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    padding: 12px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
  chatMessageContent: css`
    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorText};
  `,
  chatMessageRole: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    text-transform: uppercase;
  `,
  commandContainer: css`
    display: flex;
    flex-direction: column;
  `,
  commandFooter: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: center;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  commandRoot: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: min(640px, 90vw);
    max-height: min(500px, 70vh);
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};

    animation: ${slideDown} 0.12s ease-out;

    &[data-closing='true'] {
      animation: ${slideUp} 0.15s ease-out forwards;
    }

    [cmdk-input] {
      flex: 1;

      min-width: 0;
      padding: 0;
      border: none;

      font-family: inherit;
      font-size: 16px;
      color: ${cssVar.colorText};

      background: transparent;
      outline: none;

      &::placeholder {
        color: ${cssVar.colorTextPlaceholder};
      }
    }

    [cmdk-list] {
      overflow-y: auto;
      max-height: 400px;
      padding: 8px;
    }

    [cmdk-empty] {
      padding-block: 32px;
      padding-inline: 16px;

      font-size: 14px;
      color: ${cssVar.colorTextTertiary};
      text-align: center;
    }

    [cmdk-item] {
      cursor: pointer;
      user-select: none;

      display: flex;
      gap: 12px;
      align-items: center;

      padding-block: 12px;
      padding-inline: 16px;
      border-radius: ${cssVar.borderRadius};

      color: ${cssVar.colorText};

      transition: all 0.15s ease;

      &[aria-selected='true'] {
        background: ${cssVar.colorBgTextHover};
      }

      &:hover {
        background: ${cssVar.colorBgTextHover};
      }
    }

    [cmdk-group-heading] {
      user-select: none;

      padding-block: 8px;
      padding-inline: 16px;

      font-size: 12px;
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
    }

    [cmdk-separator] {
      height: 1px;
      margin-block: 4px;
      background: ${cssVar.colorBorderSecondary};
    }
  `,
  contextTag: css`
    font-size: 12px;
  `,
  contextWrapper: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 16px;
  `,
  icon: css`
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    color: ${cssVar.colorTextSecondary};
  `,
  inputWrapper: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  itemContent: css`
    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;

    min-width: 0;
  `,
  itemDescription: css`
    overflow: hidden;

    margin-block-start: 2px;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  itemDetails: css`
    flex: 1;
    min-width: 0;
  `,
  itemIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;

    color: ${cssVar.colorTextSecondary};
  `,
  itemLabel: css`
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
  `,
  itemTitle: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  itemType: css`
    flex-shrink: 0;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-transform: capitalize;
  `,
  kbd: css`
    display: flex;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  kbdIcon: css`
    width: 14px;
    height: 14px;
    color: ${cssVar.colorTextTertiary};
  `,
  overlay: css`
    position: fixed;
    z-index: 9999;
    inset: 0;

    display: flex;
    align-items: flex-start;
    justify-content: center;

    padding-block-start: 15vh;

    background: ${cssVar.colorBgMask};

    animation: ${fadeIn} 0.1s ease-in-out;

    &[data-closing='true'] {
      animation: ${fadeOut} 0.15s ease-out forwards;
    }
  `,
  skeleton: css`
    height: 16px;
    border-radius: ${cssVar.borderRadiusSM};

    background: linear-gradient(
      90deg,
      ${cssVar.colorFillSecondary} 25%,
      ${cssVar.colorFillTertiary} 50%,
      ${cssVar.colorFillSecondary} 75%
    );
    background-size: 200% 100%;

    animation: ${pulse} 1.5s ease-in-out infinite;
  `,
  skeletonItem: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
  `,
}));
