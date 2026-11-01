import { createStaticStyles } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    width: 32px;
    height: 32px;
    border-radius: 9px;

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
    padding: 16px;
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
    min-height: 44px;
    margin-block-start: 6px;
    padding-inline: 10px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font: inherit;
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
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorWarningText};

    background: ${cssVar.colorWarningBg};
  `,
  panel: css`
    padding: 6px;
  `,
  section: css`
    padding-block: 10px 12px;
    padding-inline: 10px;
  `,
  url: css`
    flex: 1;
    min-width: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
}));
