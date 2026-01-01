import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  bannerDark: css`
    opacity: 0.9;
  `,
  bannerLight: css`
    opacity: 0.4;
  `,
  containerDark: css`
    position: relative;

    overflow: hidden;

    height: 100%;
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 1px 1px ${cssVar.colorFillQuaternary} inset;

    transition: box-shadow 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      box-shadow: 0 0 1px 1px ${cssVar.colorFillSecondary} inset;
    }
  `,
  containerLight: css`
    position: relative;

    overflow: hidden;

    height: 100%;
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 1px 1px ${cssVar.colorFillSecondary} inset;

    transition: box-shadow 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      box-shadow: 0 0 1px 1px ${cssVar.colorFill} inset;
    }
  `,
  desc: css`
    min-height: 44px;
    margin-block-end: 0 !important;
    color: ${cssVar.colorTextDescription};
  `,
  tagBlue: css`
    color: ${cssVar.geekblue};
    background: ${cssVar.geekblue1};
  `,
  tagGreen: css`
    color: ${cssVar.green};
    background: ${cssVar.green1};
  `,
  time: css`
    color: ${cssVar.colorTextDescription};
  `,
  title: css`
    zoom: 1.2;
    margin-block-end: 0 !important;
    font-size: 18px !important;
    font-weight: bold;
  `,
  token: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
}));
