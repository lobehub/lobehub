import { type BlockProps } from '@lobehub/ui';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { Spin, Statistic } from 'antd';
import { createStaticStyles, responsive } from 'antd-style';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    ${responsive.sm} {
      flex-wrap: wrap;
      margin-block-end: 8px;
    }
  `,
  statistic: css`
    .${prefixCls}-statistic-content-value-int, .${prefixCls}-statistic-content-value-decimal {
      font-size: 24px;
      font-weight: bold;
      line-height: 1.2;
    }
  `,
  title: css`
    overflow: hidden;
    flex: 1;

    font-size: 16px;
    font-weight: 500;
    line-height: 32px;
    color: ${cssVar.colorText};

    ${responsive.sm} {
      font-size: 14px;
      line-height: 16px;
    }
  `,
}));

export interface StatisticConfig {
  description?: ReactNode;
  precision?: number;
  prefix?: ReactNode;
  style?: CSSProperties;
  suffix?: ReactNode;
  value?: number | string;
  valueStyle?: CSSProperties;
}

export interface StatisticCardProps extends Pick<
  BlockProps,
  'variant' | 'padding' | 'paddingBlock' | 'paddingInline'
> {
  className?: string;
  extra?: ReactNode;
  loading?: boolean;
  statistic?: StatisticConfig;
  style?: CSSProperties;
  title?: ReactNode;
}

const StatisticCard = memo<StatisticCardProps>(
  ({
    title,
    className,
    variant = 'borderless',
    loading,
    extra,
    style,
    padding,
    paddingBlock,
    paddingInline,
    statistic,
  }) => {
    return (
      <Block
        className={className}
        flex={1}
        padding={padding}
        paddingBlock={paddingBlock}
        paddingInline={paddingInline}
        style={style}
        variant={variant}
      >
        <div className={styles.header}>
          <div className={styles.title}>
            {typeof title === 'string' ? (
              <Text
                as={'h2'}
                ellipsis={{ rows: 1, tooltip: true }}
                style={{
                  fontSize: 'inherit',
                  fontWeight: 'inherit',
                  lineHeight: 'inherit',
                  margin: 0,
                  overflow: 'hidden',
                }}
              >
                {title}
              </Text>
            ) : (
              title
            )}
          </div>
          {loading ? <Spin percent={'auto'} size={'small'} /> : extra}
        </div>
        {statistic && (
          <Flexbox gap={16} style={statistic.style}>
            <Statistic
              className={styles.statistic}
              precision={statistic.precision}
              prefix={statistic.prefix}
              styles={statistic.valueStyle ? { content: statistic.valueStyle } : undefined}
              suffix={statistic.suffix}
              value={statistic.value}
            />
            {statistic.description}
          </Flexbox>
        )}
      </Block>
    );
  },
);

export default StatisticCard;
