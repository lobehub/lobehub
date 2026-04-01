import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBtn: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 16px;
    border: none;
    border-radius: 20px;

    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: ${cssVar.colorFillQuaternary};

    transition: background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  actionBtnPrimary: css`
    color: #fff;
    background: ${cssVar.colorText};

    &:hover {
      opacity: 0.85;
      background: ${cssVar.colorText};
    }
  `,
  collapsed: css`
    overflow: hidden;
    max-height: 100px;
  `,
  expandLink: css`
    cursor: pointer;

    padding: 0;
    border: none;

    font-size: 13px;
    color: ${cssVar.colorLink};

    background: none;
  `,
  resolvedTag: css`
    font-size: 13px;
    color: ${cssVar.colorTextQuaternary};
  `,
  editorWrapper: css`
    overflow: hidden auto;

    width: 100%;
    max-height: 200px;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  summaryBox: css`
    padding: 16px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));
