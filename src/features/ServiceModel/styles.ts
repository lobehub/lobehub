import { createStaticStyles } from 'antd-style';

export const serviceModelFormStyles = createStaticStyles(({ css }) => ({
  // antd pins the label to `controlHeight` at the top of the row, which reads
  // fine under a two-line label but leaves a lone title floating above its
  // control. Rows without a subtitle need the label to stretch and center
  // itself against the control instead.
  centeredLabel: css`
    .ant-form-item-label > label {
      align-items: center;
      block-size: 100%;
      min-block-size: 36px;
    }
  `,
}));
