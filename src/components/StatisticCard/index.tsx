import { type StatisticCardProps as AntdStatisticCardProps } from '@ant-design/pro-components';
import { StatisticCard as AntdStatisticCard } from '@ant-design/pro-components';
import { type BlockProps } from '@lobehub/ui';
import { Block, Text } from '@lobehub/ui';
import { Spin } from 'antd';
import { createStaticStyles, cx, responsive, useResponsive } from 'antd-style';
import { memo } from 'react';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    border-radius: ${cssVar.borderRadiusLG};

    ${responsive.sm} {
      border: none;
      border-radius: 0;
      background: ${cssVar.colorBgContainer};
    }
  `,
  cardDark: css`
    border: 1px solid ${cssVar.colorFillTertiary};
  `,
  cardLight: css`
    border: 1px solid ${cssVar.colorFillSecondary};
  `,
  container: css`
    ${responsive.sm} {
      border: none;
      border-radius: 0;
      background: ${cssVar.colorBgContainer};
    }

    .${prefixCls}-pro-card-title {
      overflow: hidden;

      ${responsive.sm} {
        margin: 0;
        font-size: 14px;
        line-height: 16px !important;
      }
    }

    .${prefixCls}-pro-card-body {
      padding: 0;
      .${prefixCls}-pro-statistic-card-content {
        position: relative;
        width: 100%;
        padding-block-end: 16px;
        padding-inline: 16px;
        .${prefixCls}-pro-statistic-card-chart {
          position: relative;
          width: 100%;
        }
      }

      .${prefixCls}-pro-statistic-card-footer {
        overflow: hidden;

        margin: 0;
        padding: 0;
        border-end-start-radius: ${cssVar.borderRadiusLG};
        border-end-end-radius: ${cssVar.borderRadiusLG};
      }
    }

    .${prefixCls}-pro-card-loading-content {
      padding-block: 16px;
      padding-inline: 16px;
    }

    .${prefixCls}-pro-card-header {
      padding-block-start: 0;
      padding-inline: 0;

      .${prefixCls}-pro-card-title {
        line-height: 32px;
      }

      + .${prefixCls}-pro-card-body {
        padding-block-start: 0;
      }

      ${responsive.sm} {
        flex-wrap: wrap;
        gap: 8px;

        margin-block-end: 8px;
        padding-block-start: 0;
        padding-inline: 0;
      }
    }

    .${prefixCls}-statistic-content-value-int, .${prefixCls}-statistic-content-value-decimal {
      font-size: 24px;
      font-weight: bold;
      line-height: 1.2;
    }

    .${prefixCls}-pro-statistic-card-chart {
      margin: 0;
    }

    .${prefixCls}-pro-statistic-card-content {
      display: flex;
      flex-direction: column;
      gap: 16px;

      padding-block-end: 0 !important;
      padding-inline: 0 !important;
    }

    .${prefixCls}-pro-statistic-card-content-horizontal {
      flex-direction: row;
      align-items: center;

      .${prefixCls}-pro-statistic-card-chart {
        align-self: center;
      }
    }
  `,
  icon: css`
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillSecondary};
  `,
  raw: css`
    border: none !important;
    background: transparent !important;
  `,
}));

interface StatisticCardProps
  extends
    AntdStatisticCardProps,
    Pick<BlockProps, 'variant' | 'padding' | 'paddingBlock' | 'paddingInline'> {}

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
    ...rest
  }) => {
    const { mobile } = useResponsive();

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
        <AntdStatisticCard
          bordered={!mobile}
          className={cx(styles.container, styles.raw)}
          extra={loading ? <Spin percent={'auto'} size={'small'} /> : extra}
          title={
            typeof title === 'string' ? (
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
            )
          }
          {...rest}
        />
      </Block>
    );
  },
);

export default StatisticCard;
