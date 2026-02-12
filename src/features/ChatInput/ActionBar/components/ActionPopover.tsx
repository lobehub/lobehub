'use client';

import { type PopoverProps } from '@lobehub/ui';
import { Flexbox, Popover } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, Suspense } from 'react';

import DebugNode from '@/components/DebugNode';
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

export interface ActionPopoverProps extends Omit<PopoverProps, 'title' | 'content' | 'children'> {
  children?: ReactNode;
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
    content,
    ...rest
  }) => {
    const isMobile = useIsMobile();

    // Properly handle classNames (can be object or function)
    const resolvedClassNames =
      typeof customClassNames === 'function' ? customClassNames : customClassNames;
    const contentClassName =
      typeof resolvedClassNames === 'object' && resolvedClassNames?.content
        ? cx(styles.popoverContent, resolvedClassNames.content)
        : styles.popoverContent;

    // Properly handle styles (can be object or function)
    const resolvedStyles = typeof customStyles === 'function' ? customStyles : customStyles;
    const contentStyle =
      typeof resolvedStyles === 'object' && resolvedStyles?.content ? resolvedStyles.content : {};

    // Compose content with optional title
    const popoverContent = (
      <Suspense fallback={<DebugNode trace="ActionPopover > content" />}>
        <>
          {title && (
            <Flexbox horizontal gap={8} justify={'space-between'} style={{ marginBottom: 16 }}>
              {title}
              {extra}
              {loading && <UpdateLoading style={{ color: cssVar.colorTextSecondary }} />}
            </Flexbox>
          )}
          {content}
        </>
      </Suspense>
    );

    return (
      <Popover
        content={popoverContent}
        nativeButton={false}
        placement={isMobile ? 'top' : placement}
        classNames={{
          ...(typeof resolvedClassNames === 'object' ? resolvedClassNames : {}),
          content: contentClassName,
        }}
        styles={{
          ...(typeof resolvedStyles === 'object' ? resolvedStyles : {}),
          content: {
            maxHeight,
            maxWidth: isMobile ? undefined : maxWidth,
            minWidth: isMobile ? undefined : minWidth,
            width: isMobile ? '100vw' : undefined,
            ...contentStyle,
          },
        }}
        {...rest}
      >
        {children}
      </Popover>
    );
  },
);

export default ActionPopover;
