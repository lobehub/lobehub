import { type GridProps, type IconProps } from '@lobehub/ui';
import { Flexbox, Grid, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx, responsive } from 'antd-style';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

import CopyableLabel from '../CopyableLabel';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    bordered: css`
      overflow: hidden;
      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: ${cssVar.borderRadiusLG};
      ${responsive.sm} {
        background: ${cssVar.colorBgContainer};
      }
    `,
    cell: css`
      overflow: hidden;
      box-shadow: 0 0 0 0.5px ${cssVar.colorBorderSecondary};
    `,
    label: css`
      overflow: hidden;
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorFillQuaternary};
    `,
  };
});

export interface DescriptionItem {
  className?: string;
  classNames?: {
    label?: string;
    value?: string;
  };
  copyable?: boolean;
  icon?: IconProps['icon'];
  key: string;
  label: ReactNode;
  style?: CSSProperties;
  styles?: {
    label?: CSSProperties;
    value?: CSSProperties;
  };
  value: ReactNode;
}

interface DescriptionsProps extends Omit<GridProps, 'children'> {
  bordered?: boolean;
  classNames?: {
    item?: string;
    label?: string;
    value?: string;
  };
  items: DescriptionItem[];
  labelWidth?: number | string;
  styles?: {
    item?: CSSProperties;
    label?: CSSProperties;
    value?: CSSProperties;
  };
}

const Descriptions = memo<DescriptionsProps>(
  ({
    labelWidth = 150,
    title,
    bordered,
    className,
    items,
    classNames,
    styles: customStyles,
    ...rest
  }) => {
    return (
      <>
        {title && <h3 style={{ marginTop: 12 }}>{title}</h3>}
        <Grid
          className={cx(bordered && styles.bordered, className)}
          gap={0}
          maxItemWidth={450}
          {...rest}
        >
          {items.map((item) => (
            <Flexbox
              horizontal
              align={'center'}
              className={cx(bordered && styles.cell, item.className, classNames?.item)}
              flex={1}
              key={item.key}
              style={{
                overflow: 'hidden',
                position: 'relative',
                ...customStyles?.item,
                ...item.style,
              }}
            >
              <Flexbox
                horizontal
                align={'center'}
                className={cx(bordered && styles.label)}
                flex={'none'}
                gap={6}
                paddingBlock={bordered ? 12 : 4}
                paddingInline={bordered ? 16 : 0}
                style={{ height: '100%', position: 'relative' }}
                width={labelWidth}
              >
                {item.icon && <Icon color={cssVar.colorTextSecondary} icon={item.icon} />}
                <Text
                  ellipsis
                  className={cx(classNames?.label, item.classNames?.label)}
                  style={{
                    color: cssVar.colorTextSecondary,
                    ...customStyles?.label,
                    ...item.styles?.label,
                  }}
                >
                  {item.label}
                </Text>
              </Flexbox>
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                justify={'flex-start'}
                paddingBlock={bordered ? 12 : 4}
                paddingInline={16}
                style={{ height: '100%', overflow: 'hidden', position: 'relative' }}
              >
                {item.copyable ? (
                  <CopyableLabel
                    className={cx(classNames?.value, item.classNames?.value)}
                    style={{ ...customStyles?.value, ...item.styles?.value }}
                    value={item.value ? String(item.value) : '--'}
                  />
                ) : (
                  <Text
                    ellipsis
                    className={cx(classNames?.value, item.classNames?.value)}
                    style={{ ...customStyles?.value, ...item.styles?.value }}
                  >
                    {item.value}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
          ))}
        </Grid>
      </>
    );
  },
);

export default Descriptions;
