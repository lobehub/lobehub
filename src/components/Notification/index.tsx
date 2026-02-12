'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { XIcon } from 'lucide-react';
import { memo } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

const styles = createStaticStyles(({ css }) => ({
  cancelIcon: css`
    position: absolute;
    z-index: 100;
    inset-block-start: 8px;
    inset-inline-end: 8px;
  `,
  container: css`
    position: absolute;
    z-index: 1100;
    inset-block-end: 16px;
    inset-inline-end: 20px;

    overflow: hidden;

    border: 1px solid ${cssVar.colorSplit};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  mobileContainer: css`
    inset-block-end: 8px;
    inset-inline-start: 8px;
  `,
  wrapper: css`
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, ${cssVar.colorBgContainer} 0%, transparent),
        ${cssVar.colorBgContainer} var(--gradient-stop, 140px)
      ),
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cg fill='${cssVar.colorFillTertiary}' %3E %3Cpolygon fill-rule='evenodd' points='8 4 12 6 8 8 6 12 4 8 0 6 4 4 6 0 8 4'/%3E%3C/g%3E%3C/svg%3E");
  `,
  wrapperDark: css`
    --gradient-stop: 80px;
  `,
  wrapperLight: css`
    --gradient-stop: 140px;
  `,
}));

interface NotificationProps extends FlexboxProps {
  height?: number | string;
  mobile?: boolean;
  onCancel?: (show?: boolean) => void;
  show: boolean;
  showCloseIcon?: boolean;
  width?: number | string;
  wrapper?: FlexboxProps;
}

const Notification = memo<NotificationProps>(
  ({
    mobile,
    children,
    show,
    onCancel,
    showCloseIcon = true,
    width = 422,
    height = 'auto',
    wrapper = {},
    className,
    ...rest
  }) => {
    const isDarkMode = useIsDark();
    const { className: wrapperClassName, ...restWrapper } = wrapper;
    return (
      show && (
        <Flexbox
          className={cx(styles.container, mobile && styles.mobileContainer, className)}
          height={height}
          width={mobile ? 'calc(100% - 16px)' : width}
          {...rest}
        >
          {showCloseIcon && (
            <ActionIcon className={styles.cancelIcon} icon={XIcon} onClick={() => onCancel?.()} />
          )}
          <Flexbox
            horizontal
            gap={16}
            padding={'20px 20px 16px'}
            className={cx(
              styles.wrapper,
              isDarkMode ? styles.wrapperDark : styles.wrapperLight,
              wrapperClassName,
            )}
            {...restWrapper}
          >
            {children}
          </Flexbox>
        </Flexbox>
      )
    );
  },
);

export default Notification;
