import { Flexbox, Tag } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

const UpgradeBadge = memo(({ children, showBadge }: PropsWithChildren<{ showBadge?: boolean }>) => {
  if (!showBadge) return children;

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      {children}
      <Tag color={'info'} size={'small'} style={{ borderRadius: 16, paddingInline: 8 }}>
        new
      </Tag>
    </Flexbox>
  );
});

export default UpgradeBadge;
