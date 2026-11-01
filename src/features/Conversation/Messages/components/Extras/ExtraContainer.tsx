import { Divider } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

const ExtraContainer = memo<PropsWithChildren>(({ children }) => {
  return (
    <div>
      <Divider style={{ margin: '0 0 8px 0' }} />
      {children}
    </div>
  );
});

export default ExtraContainer;
