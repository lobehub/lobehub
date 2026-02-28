import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

const SidebarContainer: FC<FlexboxProps> = ({ children, style, ...rest }) => {
  return (
    <Flexbox
      flex={'none'}
      gap={48}
      height={'100%'}
      style={{ position: 'relative', width: 320, ...style }}
      width={'100%'}
      {...rest}
    >
      {children}
    </Flexbox>
  );
};

export default SidebarContainer;
