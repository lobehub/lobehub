import { ScrollShadow } from '@lobehub/ui';
import { type FC, type PropsWithChildren } from 'react';

const CategoryContainer: FC<PropsWithChildren<{ top?: number }>> = ({ children, top = 16 }) => {
  return (
    <ScrollShadow
      hideScrollBar
      as={'aside'}
      flex={'none'}
      height={`calc(100vh - ${top * 2 + 4}px)`}
      offset={16}
      size={4}
      style={{ paddingBottom: 16, position: 'sticky', top }}
      width={280}
    >
      {children}
    </ScrollShadow>
  );
};

export default CategoryContainer;
