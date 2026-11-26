// oxlint-disable-next-line stylex-migration/no-emotion-styles -- moved verbatim from SharePopover/style.ts; the tile's nested :hover/:disabled span selectors have no StyleX form yet
import { createStaticStyles } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  qrcode: css`
    flex: none;
    padding: 6px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorWhite};
  `,
  socialGrid: css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  `,
  socialIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${cssVar.colorTextSecondary};
  `,
  socialLabel: css`
    overflow: hidden;

    max-width: 100%;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  socialPanel: css`
    padding: ${densityVars.contentGap};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  socialPreview: css`
    padding-block: 6px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorText};
    word-break: break-all;
    white-space: pre-wrap;

    background: ${cssVar.colorBgContainer};
  `,
  socialTile: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    justify-content: center;

    min-width: 0;
    min-height: 56px;
    padding: 6px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    font: inherit;

    background: transparent;

    transition:
      background 150ms ${cssVar.motionEaseOut},
      border-color 150ms ${cssVar.motionEaseOut};

    &:hover:not(:disabled) {
      background: ${cssVar.colorFillTertiary};
    }

    &:hover:not(:disabled) span {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: -2px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
  `,
  socialTileActive: css`
    border-color: ${cssVar.colorPrimaryBorder};
    background: ${cssVar.colorPrimaryBg};

    span {
      color: ${cssVar.colorPrimaryText};
    }
  `,
}));
