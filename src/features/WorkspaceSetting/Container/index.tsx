'use client';

import { Flexbox, type FlexboxProps } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, type PropsWithChildren, type ReactNode } from 'react';

interface WorkspaceSettingsContainerProps extends FlexboxProps {
  addonAfter?: ReactNode;
  addonBefore?: ReactNode;
  maxWidth?: number | string;
}

const WorkspaceSettingsContainer = memo<PropsWithChildren<WorkspaceSettingsContainerProps>>(
  ({ maxWidth = 1024, children, addonAfter, addonBefore, style, ...rest }) => {
    return (
      <Flexbox
        align={'center'}
        height={'100%'}
        width={'100%'}
        style={{
          background: cssVar.colorBgContainer,
          overflowX: 'hidden',
          overflowY: 'auto',
          ...style,
        }}
        {...rest}
      >
        {addonBefore}
        <Flexbox flex={1} gap={36} style={{ maxWidth }} width={'100%'}>
          {children}
        </Flexbox>
        {addonAfter}
      </Flexbox>
    );
  },
);

export default WorkspaceSettingsContainer;
