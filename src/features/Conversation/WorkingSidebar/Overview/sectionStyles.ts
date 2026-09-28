import { createStaticStyles } from 'antd-style';

export const sectionStyles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    text-transform: none;
    letter-spacing: 0;

    background: ${cssVar.colorFillSecondary};
  `,
  pill: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    height: 20px;
    padding-inline: 7px;
    border-radius: 6px;

    font-size: 11.5px;
    font-weight: 500;
    line-height: 20px;
  `,
  section: css`
    flex-shrink: 0;
    padding-block: 8px;
    padding-inline: 8px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  sectionHeader: css`
    padding-block: 0 4px;
    padding-inline: 8px;
  `,
  sectionTitle: css`
    font-size: 10.5px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.08em;
  `,
  skeleton: css`
    padding-block: 4px;
    padding-inline: 8px;
  `,
}));
