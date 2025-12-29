'use client';

import { Flexbox } from '@lobehub/ui';
import { Popover, type PopoverProps } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode, memo } from 'react';

import UpdateLoading from '@/components/Loading/UpdateLoading';
import { useIsMobile } from '@/hooks/useIsMobile';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  popoverContent: css`
    .${prefixCls}-form {
      .${prefixCls}-form-item:first-child {
        padding-block: 0 4px;
      }
      .${prefixCls}-form-item:last-child {
        padding-block: 4px 0;
      }
    }
  `,
}));

export interface ActionPopoverProps extends Omit<PopoverProps, 'title' | 'content'> {
  content?: ReactNode;
  extra?: ReactNode;
  loading?: boolean;
  maxHeight?: number | string;
  maxWidth?: number | string;
  minWidth?: number | string;
  title?: ReactNode;
}

const ActionPopover = memo<ActionPopoverProps>(
  ({
    styles: customStyles,
    maxHeight,
    maxWidth,
    minWidth,
    children,
    classNames: customClassNames,
    title,
    placement,
    loading,
    extra,
    ...rest
  }) => {
    const isMobile = useIsMobile();

    // Properly handle classNames (can be object or function)
    const resolvedClassNames =
      typeof customClassNames === 'function' ? customClassNames : customClassNames;
    const containerClassName =
      typeof resolvedClassNames === 'object' && resolvedClassNames?.container
        ? cx(styles.popoverContent, resolvedClassNames.container)
        : styles.popoverContent;

    // Properly handle styles (can be object or function)
    const resolvedStyles = typeof customStyles === 'function' ? customStyles : customStyles;
    const containerStyle =
      typeof resolvedStyles === 'object' && resolvedStyles?.container
        ? resolvedStyles.container
        : {};

    return (
      <Popover
        arrow={false}
        classNames={{
          ...(typeof resolvedClassNames === 'object' ? resolvedClassNames : {}),
          container: containerClassName,
        }}
        placement={isMobile ? 'top' : placement}
        styles={{
          ...(typeof resolvedStyles === 'object' ? resolvedStyles : {}),
          container: {
            maxHeight,
            maxWidth: isMobile ? undefined : maxWidth,
            minWidth: isMobile ? undefined : minWidth,
            width: isMobile ? '100vw' : undefined,
            ...containerStyle,
          },
        }}
        title={
          title && (
            <Flexbox gap={8} horizontal justify={'space-between'} style={{ marginBottom: 16 }}>
              {title}
              {extra}
              {loading && <UpdateLoading style={{ color: cssVar.colorTextSecondary }} />}
            </Flexbox>
          )
        }
        {...rest}
      >
        {children}
      </Popover>
    );
  },
);

export default ActionPopover;
