import { createStaticStyles } from 'antd-style';

import { getThemeToken } from './theme';

const colorToken = getThemeToken();
// 文字排版相关的通用样式
export const typographyStyles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    display: inline-block;

    padding-block: ${cssVar.paddingXS};
    padding-inline: ${cssVar.paddingMD};
    border-radius: 100px;

    font-size: ${cssVar.fontSize};
    font-weight: 500;
    color: #000;

    background-color: ${colorToken.colorHighlight};
  `,

  // 正文文本 - 用于主要内容
  body: css`
    max-width: 672px;
    margin: 0;
    padding-block: 0;
    padding-inline: ${cssVar.paddingLG};

    font-size: ${cssVar.fontSizeLG};
    line-height: ${cssVar.lineHeight};
    color: ${colorToken.colorTextSecondary};
    text-align: center;
  `,

  // 加粗文本
  bold: css`
    font-weight: 600;
  `,

  // 描述文本 - 用于次要说明
  description: css`
    max-width: 576px;
    margin: 0;

    font-size: ${cssVar.fontSize};
    line-height: ${cssVar.lineHeight};
    color: ${colorToken.colorTextSecondary};
    text-align: center;
  `,

  // 主标题 - 用于页面主要标题
  heroTitle: css`
    font-family: ${cssVar.fontFamily};
    font-size: 80px;
    font-weight: 900;
    font-style: italic;
    line-height: 0.9;
    color: ${colorToken.colorTextBase};
    text-align: center;
    letter-spacing: -5px;
  `,

  // 小号文本
  small: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${colorToken.colorTextSecondary};
  `,

  // 副标题 - 用于次级标题
  subtitle: css`
    margin-block: ${cssVar.marginXS};
    margin-inline: 0;

    font-family: ${cssVar.fontFamily};
    font-size: 48px;
    font-weight: 700;
    font-style: italic;
    color: ${colorToken.colorTextBase};
    text-align: center;
  `,

  // 文本对齐
  textCenter: css`
    text-align: center;
  `,

  textLeft: css`
    text-align: start;
  `,

  textRight: css`
    text-align: end;
  `,
}));
