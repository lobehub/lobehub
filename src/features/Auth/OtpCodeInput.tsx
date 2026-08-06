import { Input } from 'antd';
import { createStaticStyles } from 'antd-style';

const styles = createStaticStyles(({ css }) => ({
  otp: css`
    direction: ltr;
    display: flex;
    justify-content: space-between;
    width: 100%;

    .ant-otp-input-wrapper {
      flex: 1;
      min-width: 0;
    }

    .ant-otp-input {
      width: 100%;
    }
  `,
}));

interface OtpCodeInputProps {
  autoFocus?: boolean;
  size?: 'large' | 'middle' | 'small';
}

export const OtpCodeInput = ({ autoFocus, size = 'large' }: OtpCodeInputProps) => (
  <Input.OTP autoFocus={autoFocus} className={styles.otp} length={6} size={size} />
);
