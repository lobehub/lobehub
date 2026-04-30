import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  fieldLabel: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  footer: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-block-start: 4px;
  `,
  header: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  root: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  tag: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
}));
