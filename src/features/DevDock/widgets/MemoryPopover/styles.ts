import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  bar: css`
    height: 4px;
    border-radius: 2px;
    background: ${cssVar.colorFillSecondary};
  `,
  barFill: css`
    height: 100%;
    border-radius: 2px;
    background: ${cssVar.colorInfo};
  `,
  caption: css`
    padding-block: 6px;
    padding-inline: 12px;
    font-size: 10px;
    color: ${cssVar.colorTextQuaternary};
  `,
  cell: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  error: css`
    color: ${cssVar.colorError};
  `,
  key: css`
    font-size: 10px;
    color: ${cssVar.colorTextQuaternary};
  `,
  legend: css`
    flex-shrink: 0;

    padding-block: 8px 12px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 10px;
    line-height: 1.6;
    color: ${cssVar.colorTextQuaternary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorTextSecondary};
  `,
  muted: css`
    color: ${cssVar.colorTextTertiary};
  `,
  popover: css`
    width: min(640px, calc(100vw - 32px));
    max-height: min(70vh, 720px);
  `,
  overview: css`
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    flex-shrink: 0;
    gap: 8px 12px;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  row: css`
    display: grid;
    grid-template-columns: 1fr 96px 120px;
    gap: 8px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  rowClickable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  scroll: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
    max-height: 360px;
  `,
  sectionTitle: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  value: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorText};
    white-space: nowrap;
  `,
}));
