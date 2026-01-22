import { createStaticStyles } from 'antd-style';

import { imageUrl } from '@/const/url';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  background: css`
    padding: 24px;

    background-color: ${cssVar.colorBgLayout};
    background-image: url(${imageUrl('screenshot_background.webp')});
    background-position: center;
    background-size: 120% 120%;
  `,
  container: css`
    background: ${cssVar.colorBgContainer};
  `,
  container_withBackground_true: css`
    overflow: hidden;
    border: 2px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  footer: css`
    padding: 16px;
    border-block-start: 1px solid ${cssVar.colorBorder};
  `,
  header: css`
    margin-block-end: -24px;
    padding-block: 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorder};
    background: ${cssVar.colorBgContainer};
  `,
  role: css`
    margin-block-start: 12px;
    padding-block-start: 12px;
    border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
    opacity: 0.75;

    * {
      font-size: 12px !important;
    }
  `,
  url: css`
    color: ${cssVar.colorTextDescription};
  `,
}));
