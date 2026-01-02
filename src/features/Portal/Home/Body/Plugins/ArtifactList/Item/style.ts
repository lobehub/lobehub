import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;

    width: 100%;
    padding-block: 10px;
    padding-inline: 8px;
    padding-inline-end: 12px;
    border-radius: 8px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  plugin: css`
    display: flex;
    gap: 4px;
    align-items: center;
    width: fit-content;
  `,
  tag: css`
    cursor: default;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 4px;
  `,
  tagBlue: css`
    color: ${cssVar.geekblue};
    background: ${cssVar.geekblue1};
  `,
  tagGreen: css`
    color: ${cssVar.green};
    background: ${cssVar.green1};
  `,
}));
