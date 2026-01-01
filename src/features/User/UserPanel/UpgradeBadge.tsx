import { Flexbox, Tag } from '@lobehub/ui';
import { type PropsWithChildren, memo } from 'react';

const UpgradeBadge = memo(({ children, showBadge }: PropsWithChildren<{ showBadge?: boolean }>) => {
  if (!showBadge) return children;

  return (
    <Flexbox align={'center'} gap={2} horizontal>
      {children}
      <Tag color={'info'} size={'small'} style={{ borderRadius: 16, paddingInline: 8 }}>
        new
      </Tag>
    </Flexbox>
  );
});

export default UpgradeBadge;
