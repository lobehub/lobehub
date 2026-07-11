import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  backButton: css`
    position: absolute;
    inset-block-start: 12px;
    inset-inline-start: 12px;
    background: ${cssVar.colorBgContainer};
  `,

  banner: css`
    position: relative;

    overflow: hidden;

    aspect-ratio: 2.4;
    width: 100%;
    border-start-start-radius: ${cssVar.borderRadiusLG};
    border-start-end-radius: ${cssVar.borderRadiusLG};

    background: linear-gradient(
      135deg,
      ${cssVar.colorFillTertiary} 0%,
      ${cssVar.colorFillSecondary} 100%
    );
    background-position: center;
    background-size: cover;
  `,

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

  body: css`
    padding: 24px;
  `,

  card: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,

  description: css`
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,

  footer: css`
    padding-block: 16px;
    padding-inline: 24px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,

  hint: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,

  title: css`
    font-size: 24px;
    font-weight: bold;
  `,
}));
