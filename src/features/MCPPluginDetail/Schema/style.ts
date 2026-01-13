import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    code: css`
      font-family: ${cssVar.fontFamilyCode};
    `,
  };
});
