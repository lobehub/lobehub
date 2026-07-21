import { ConfigProvider, Rate as AntdRate, type RateProps as AntdRateProps } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => {
  return {
    rate: css`
      display: flex;
      align-items: center;

      .ant-rate-star {
        margin: 0 !important;
      }
    `,
  };
});

interface RateProps extends Omit<AntdRateProps, 'size'> {
  color?: string;
  gap?: number;
  size?: number;
}

const Rate = memo<RateProps>(
  ({ gap, style, className, size = 16, color = cssVar.colorWarning, ...props }) => {
    return (
      <ConfigProvider
        theme={{
          components: {
            Rate: {
              starBg: cssVar.colorFill,
              starColor: color,
              starSize: size,
            },
          },
        }}
      >
        <AntdRate
          allowHalf
          disabled
          className={cx(styles.rate, className)}
          style={{
            gap: gap || size / 2,
            ...style,
          }}
          {...props}
        />
      </ConfigProvider>
    );
  },
);

export default Rate;
