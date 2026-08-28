import { createStaticStyles } from 'antd-style';

import { SPIN_TURN_MS } from './spinHold';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    &:hover {
      border-color: ${cssVar.colorBorder} !important;
    }
  `,
  compactRow: css`
    justify-content: flex-start;

    width: calc(100% + 16px);
    height: auto;
    margin-inline: -8px;
    padding-block: 6px;
    padding-inline: 8px;
    border: 0;
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    transition: background ${cssVar.motionDurationFast};

    /* the selector mirrors base-ui's variantText hover rule so the row tint
       can outrank its brighter fill */
    &:hover:not(:disabled, [aria-disabled='true']) {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  compactTitle: css`
    min-width: 0;
  `,
  refreshSpin: css`
    animation: recommendations-refresh-spin ${SPIN_TURN_MS}ms linear infinite;

    @keyframes recommendations-refresh-spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Keep the "working" signal, drop the rotation. */
    @media (prefers-reduced-motion: reduce) {
      opacity: 0.45;
      animation: none;
    }
  `,
  subtitle: css`
    color: ${cssVar.colorTextDescription};
  `,
}));
