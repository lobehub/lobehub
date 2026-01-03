import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css }) => {
  return {
    children: css`
      &::before {
        content: '';
        position: absolute;
        inset: 0;
        background-color: transparent;
      }
    `,
    wrapper: css`
      font-size: inherit;
    `,
  };
});
