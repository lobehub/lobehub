import { createStaticStyles } from 'antd-style';

export const inspectorChipStyles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 4px;
    align-items: center;

    min-width: 0;
    max-width: 240px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  emoji: css`
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1;
  `,
  meta: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  separator: css`
    flex-shrink: 0;
    margin-inline: 4px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));
