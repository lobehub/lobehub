import { createStaticStyles } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    width: ${densityVars.iconBox};
    height: ${densityVars.iconBox};
    border-radius: ${densityVars.radius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};

    transition:
      background 200ms ${cssVar.motionEaseOut},
      color 200ms ${cssVar.motionEaseOut};
  `,
  badgeActive: css`
    color: ${cssVar.colorSuccess};
    background: ${cssVar.colorSuccessBg};
  `,
  container: css`
    padding: ${densityVars.sectionGap};
  `,
  divider: css`
    height: 1px;
    margin-inline: 4px;
    background: ${cssVar.colorBorderSecondary};
  `,
  exportHint: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  exportIcon: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  exportLabel: css`
    flex: 1;
    text-align: start;
  `,
  exportRow: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: ${densityVars.rowHeight};
    margin-block-start: 6px;
    padding-inline: 10px;
    border: none;
    border-radius: ${densityVars.radius};

    font: inherit;
    font-size: ${densityVars.fontSize};
    color: ${cssVar.colorText};

    background: transparent;

    transition: background 150ms ${cssVar.motionEaseOut};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: -2px;
    }
  `,
  notice: css`
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${densityVars.radius};

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorWarningText};

    background: ${cssVar.colorWarningBg};
  `,
  panel: css`
    padding: 6px;
  `,
  qrcode: css`
    flex: none;
    padding: 6px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorWhite};
  `,
  section: css`
    padding-block: 10px 12px;
    padding-inline: 10px;
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
    padding: 12px;
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
  url: css`
    flex: 1;
    min-width: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
}));
