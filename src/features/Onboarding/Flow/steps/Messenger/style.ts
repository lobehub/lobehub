import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  bannerAvatar: css`
    flex: none;
  `,

  bannerContent: css`
    position: absolute;
    inset: 0;
    padding: 24px;
  `,

  bannerQuote: css`
    font-size: 15px;
    font-weight: 500;
    line-height: 1.5;
    color: ${cssVar.colorText};
  `,

  bannerQuoteHighlight: css`
    font-weight: 700;
  `,

  localAgentsIconStrip: css`
    display: flex;
    gap: 8px;
  `,

  localAgentsIconTile: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  localAgentsNote: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,

  localAgentsPanel: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,

  row: css`
    padding-block: 4px;
  `,

  rowIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    background: ${cssVar.colorFillTertiary};
  `,

  rowLabel: css`
    font-size: 14px;
    font-weight: 500;
  `,

  sectionHint: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,

  sectionTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));
