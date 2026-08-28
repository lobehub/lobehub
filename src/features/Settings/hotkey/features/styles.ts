import { createStaticStyles } from 'antd-style';

export const hotkeyFormStyles = createStaticStyles(({ css }) => ({
  item: css`
    .ant-form-item-label > label {
      align-items: center;
      min-block-size: 36px;
    }
  `,
}));
