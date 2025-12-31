'use client';

import { Flexbox, type FlexboxProps } from '@lobehub/ui';
import { cssVar, useTheme } from 'antd-style';
import { type PropsWithChildren, type ReactNode, memo } from 'react';

interface SettingContainerProps extends FlexboxProps {
  addonAfter?: ReactNode;
  addonBefore?: ReactNode;
  maxWidth?: number | string;
  variant?: 'default' | 'secondary';
}
const SettingContainer = memo<PropsWithChildren<SettingContainerProps>>(
  ({ variant, maxWidth = 1024, children, addonAfter, addonBefore, style, ...rest }) => {
    const theme = useTheme(); // Keep for colorBgContainerSecondary (not in cssVar)
    return (
      <Flexbox
        align={'center'}
        height={'100%'}
        style={{
          background:
            variant === 'secondary' ? theme.colorBgContainerSecondary : cssVar.colorBgContainer,
          overflowX: 'hidden',
          overflowY: 'auto',
          ...style,
        }}
        width={'100%'}
        {...rest}
      >
        {addonBefore}
        <Flexbox
          flex={1}
          gap={36}
          style={{
            maxWidth,
          }}
          width={'100%'}
        >
          {children}
        </Flexbox>
        {addonAfter}
      </Flexbox>
    );
  },
);

export default SettingContainer;
