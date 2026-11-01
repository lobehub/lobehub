'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { XIcon } from 'lucide-react';
import { memo } from 'react';

import { useIsDark } from '@/hooks/useIsDark';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  cancelIcon: {
    position: 'absolute',
    zIndex: 100,
    insetBlockStart: '8px',
    insetInlineEnd: '8px',
  },
  container: {
    position: 'absolute',
    zIndex: 1100,
    insetBlockEnd: '16px',
    insetInlineEnd: '20px',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorSplit,
    borderRadius: '8px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  mobileContainer: {
    insetBlockEnd: '8px',
    insetInlineStart: '8px',
  },
  wrapper: {
    backgroundImage: `linear-gradient(
        180deg,
        color-mix(in srgb, ${cssVar.colorBgContainer} 0%, transparent),
        ${cssVar.colorBgContainer} var(--gradient-stop, 140px)
      ),
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cg fill='${cssVar.colorFillTertiary}' %3E %3Cpolygon fill-rule='evenodd' points='8 4 12 6 8 8 6 12 4 8 0 6 4 4 6 0 8 4'/%3E%3C/g%3E%3C/svg%3E")`,
  },
  wrapperDark: { '--gradient-stop': '80px' },
  wrapperLight: { '--gradient-stop': '140px' },
});

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
          height={height}
          width={mobile ? 'calc(100% - 16px)' : width}
          {...sx([styles.container, mobile && styles.mobileContainer], className)}
          {...rest}
        >
          {showCloseIcon && (
            <ActionIcon
              className={stylex.props(styles.cancelIcon).className}
              icon={XIcon}
              onClick={() => onCancel?.()}
            />
          )}
          <Flexbox
            horizontal
            gap={16}
            padding={'20px 20px 16px'}
            {...sx(
              [styles.wrapper, isDarkMode ? styles.wrapperDark : styles.wrapperLight],
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
