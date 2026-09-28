import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    code: css`
      font-family: ${cssVar.fontFamilyCode};
    `,
    desc: css`
      overflow: hidden;

      margin: 0;

      font-size: 13px;
      line-height: 20px;
      color: ${cssVar.colorTextTertiary};
      text-overflow: ellipsis;
      white-space: nowrap;
    `,
    empty: css`
      padding: 18px;
      border: 1px dashed ${cssVar.colorBorder};
      border-radius: ${cssVar.borderRadiusLG};

      font-size: 13px;
      color: ${cssVar.colorTextTertiary};
      text-align: center;
    `,
    meta: css`
      flex: none;
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      color: ${cssVar.colorTextQuaternary};
    `,
    name: css`
      font-family: ${cssVar.fontFamilyCode};
      font-size: 14px;
      font-weight: 500;
      line-height: 20px;
    `,
    sectionDesc: css`
      margin: 0;
      font-size: 13px;
      color: ${cssVar.colorTextTertiary};
    `,
    subtitle: css`
      font-size: 12px;
      font-weight: 500;
      color: ${cssVar.colorTextTertiary};
      text-transform: uppercase;
      letter-spacing: 0.04em;
    `,
    sectionTitle: css`
      margin: 0;

      font-size: 16px;
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    `,
  };
});
