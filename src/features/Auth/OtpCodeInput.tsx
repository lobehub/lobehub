import { Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import type { FocusEventHandler } from 'react';

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
  disabled?: boolean;
  id?: string;
  onBlur?: FocusEventHandler;
  /** Injected by Form.Item — required for OTP to bind into the form. */
  onChange?: (value: string) => void;
  size?: 'large' | 'middle' | 'small';
  status?: 'error' | 'warning';
  /** Injected by Form.Item — required for OTP to bind into the form. */
  value?: string;
}

/**
 * Form.Item-compatible OTP input. Must forward value/onChange so Ant Design
 * Form can read the entered code (otherwise submit always fails "required").
 */
export const OtpCodeInput = ({
  autoFocus,
  disabled,
  id,
  onBlur,
  onChange,
  size = 'large',
  status,
  value,
}: OtpCodeInputProps) => (
  <Input.OTP
    autoFocus={autoFocus}
    className={styles.otp}
    disabled={disabled}
    id={id}
    length={6}
    size={size}
    status={status}
    value={value}
    onBlur={onBlur}
    onChange={onChange}
  />
);
