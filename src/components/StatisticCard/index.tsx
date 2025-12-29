import {
  StatisticCard as AntdStatisticCard,
  type StatisticCardProps as AntdStatisticCardProps,
} from '@ant-design/pro-components';
import { Text } from '@lobehub/ui';
import { Spin } from 'antd';
import { createStaticStyles, cx, responsive, useResponsive, useThemeMode } from 'antd-style';
import { adjustHue } from 'polished';
import { type CSSProperties, memo, useMemo } from 'react';

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
        padding-inline: 24px;
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
      padding-inline: 24px;
    }

    .${prefixCls}-pro-card-header {
      padding-block-start: 16px;
      padding-inline: 24px;

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
      ${responsive.sm} {
        padding-block-end: 0 !important;
        padding-inline: 0 !important;
      }
    }

    .${prefixCls}-pro-statistic-card-content-horizontal {
      flex-direction: row;
      align-items: center;

      .${prefixCls}-pro-statistic-card-chart {
        align-self: center;
      }
    }
  `,
  highlight: css`
    overflow: hidden;

    &::before {
      content: '';

      position: absolute;
      z-index: 0;
      inset-block-end: -30%;
      inset-inline-end: -30%;
      transform: rotate(-15deg);

      width: 66%;
      height: 50%;
      border-radius: 50%;

      background-image: linear-gradient(
        60deg,
        var(--highlight-adjusted, #000) 20%,
        var(--highlight-color, #000) 80%
      );
      background-repeat: no-repeat;
      background-position: center left;
      background-size: contain;
      filter: blur(32px);
    }

    > div {
      z-index: 1;
    }
  `,
  highlightDark: css`
    &::before {
      opacity: 1;
    }
  `,
  highlightLight: css`
    &::before {
      opacity: 0.33;
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

interface StatisticCardProps extends AntdStatisticCardProps {
  highlight?: string;
  variant?: 'raw' | 'card';
}

const StatisticCard = memo<StatisticCardProps>(
  ({ title, className, highlight, variant, loading, extra, ...rest }) => {
    const { isDarkMode } = useThemeMode();
    const { mobile } = useResponsive();
    const isPure = variant === 'raw';

    const highlightStyles = useMemo<CSSProperties>(
      () =>
        highlight
          ? ({
              '--highlight-adjusted': adjustHue(-30, highlight),
              '--highlight-color': highlight,
            } as CSSProperties)
          : {},
      [highlight],
    );

    return (
      <AntdStatisticCard
        bordered={!mobile}
        className={cx(
          styles.container,
          isPure ? styles.raw : cx(styles.card, isDarkMode ? styles.cardDark : styles.cardLight),
          highlight &&
            cx(styles.highlight, isDarkMode ? styles.highlightDark : styles.highlightLight),
          className,
        )}
        extra={loading ? <Spin percent={'auto'} size={'small'} /> : extra}
        style={{
          ...highlightStyles,
          ...rest.style,
        }}
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
    );
  },
);

export default StatisticCard;
