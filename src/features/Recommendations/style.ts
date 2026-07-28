import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    &:hover {
      border-color: ${cssVar.colorBorder} !important;
    }
  `,
  compactRow: css`
    cursor: pointer;

    margin-inline: -8px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  compactTitle: css`
    min-width: 0;
    font-size: 14px;
    line-height: 20px;
  `,
  subtitle: css`
    color: ${cssVar.colorTextDescription};
  `,
}));
