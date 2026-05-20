import { createStaticStyles, keyframes } from 'antd-style';

const slideUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;

    max-inline-size: 460px;
    margin-block-start: 8px;
  `,
  chip: css`
    cursor: pointer;

    transform: translateY(8px);

    display: inline-flex;
    gap: 8px;
    align-items: center;

    padding-block: 7px;
    padding-inline: 10px 14px;
    border: none;
    border-radius: 8px;

    font-size: 13px;
    color: ${cssVar.colorText};

    opacity: 0;
    background: ${cssVar.colorFillTertiary};

    transition:
      background 0.15s,
      color 0.15s;
    animation: ${slideUp} 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }

    &:hover .followup-icon {
      color: ${cssVar.colorPrimary};
      opacity: 1;
    }

    @media (prefers-reduced-motion: reduce) {
      transform: none;
      opacity: 1;
      animation: none;
    }
  `,
  chipIcon: css`
    flex: none;
    opacity: 0.55;
    transition:
      opacity 0.15s,
      color 0.15s;
  `,
}));
