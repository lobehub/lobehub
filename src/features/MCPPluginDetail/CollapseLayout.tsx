import { Flexbox } from '@lobehub/ui';
import { type ReactNode, memo } from 'react';

import Title, { type TitleProps } from '../../app/[variants]/(main)/community/features/Title';

export type CollapseItemType = {
  children: ReactNode;
  key: string;
  title: ReactNode;
  titleProps?: TitleProps;
};

export interface CollapseLayoutProps {
  items: CollapseItemType[];
}

const CollapseLayout = memo<CollapseLayoutProps>(({ items }) => {
  return (
    <Flexbox gap={24}>
      {items.map((item) => (
        <Flexbox gap={12} key={item.key}>
          {item.title && (
            <Title level={3} {...item.titleProps}>
              {item.title}
            </Title>
          )}
          {item.children}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default CollapseLayout;
