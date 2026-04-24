import { createStaticStyles } from 'antd-style';

export const recommendStyles = createStaticStyles(({ css, cssVar }) => ({
  iconBadge: css`
    flex-shrink: 0;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBtn: css`
    &:hover {
      border-color: ${cssVar.colorBorder} !important;
      background: ${cssVar.colorFillQuaternary} !important;
    }
  `,
  actionBtnPrimary: css`
    &.ant-btn {
      width: auto !important;
      padding-inline: 12px !important;
    }
  `,
  expandLink: css`
    border: 1px solid ${cssVar.colorFillTertiary} !important;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  resolvedTag: css`
    font-size: 13px;
    color: ${cssVar.colorTextQuaternary};
  `,
  card: css`
    .brief-comment-btn {
      opacity: 0;
    }

    &:hover {
      border-color: ${cssVar.colorBorder} !important;

      .brief-comment-btn {
        opacity: 1;
      }
    }
  `,
  clickableHeader: css`
    cursor: pointer;
  `,
}));
