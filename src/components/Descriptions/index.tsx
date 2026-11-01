import { type GridProps, type IconProps } from '@lobehub/ui';
import { cx, Flexbox, Grid, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import CopyableLabel from '../CopyableLabel';

const styles = stylex.create({
  bordered: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: { default: null, [media.sm]: cssVar.colorBgContainer },
    backgroundImage: { default: null, [media.sm]: 'none' },
  },
  cell: {
    overflow: 'hidden',
    boxShadow: `0 0 0 0.5px ${cssVar.colorBorderSecondary}`,
  },
  label: {
    overflow: 'hidden',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
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

interface DescriptionsProps extends Omit<GridProps, 'children' | 'wrap'> {
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
  wrap?: boolean;
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
    wrap,
    ...rest
  }) => {
    return (
      <>
        {title && <h3 style={{ marginTop: 12 }}>{title}</h3>}
        <Grid
          gap={0}
          maxItemWidth={450}
          {...sx([bordered && styles.bordered], className)}
          {...rest}
        >
          {items.map((item) => (
            <Flexbox
              horizontal
              align={wrap ? 'flex-start' : 'center'}
              flex={1}
              key={item.key}
              {...sx([bordered && styles.cell], cx(item.className, classNames?.item))}
              style={{
                overflow: wrap ? undefined : 'hidden',
                position: 'relative',
                ...customStyles?.item,
                ...item.style,
              }}
            >
              <Flexbox
                horizontal
                align={'center'}
                flex={'none'}
                gap={6}
                {...sx([bordered && styles.label])}
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
                align={wrap ? 'flex-start' : 'center'}
                flex={1}
                justify={'flex-start'}
                paddingBlock={bordered ? 12 : 4}
                paddingInline={16}
                style={{
                  height: '100%',
                  overflow: wrap ? undefined : 'hidden',
                  position: 'relative',
                }}
              >
                {item.copyable ? (
                  <CopyableLabel
                    className={cx(classNames?.value, item.classNames?.value)}
                    style={{ ...customStyles?.value, ...item.styles?.value }}
                    value={item.value ? String(item.value) : '--'}
                    wrap={wrap}
                  />
                ) : (
                  <Text
                    className={cx(classNames?.value, item.classNames?.value)}
                    ellipsis={!wrap}
                    style={{
                      ...(wrap && {
                        overflowWrap: 'anywhere',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }),
                      ...customStyles?.value,
                      ...item.styles?.value,
                    }}
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
