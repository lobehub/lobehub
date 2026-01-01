import { Tag } from '@lobehub/ui';
import React, { memo } from 'react';

import { useTokenCount } from '@/hooks/useTokenCount';

const Tokens = memo<{ style?: React.CSSProperties; value: string }>(({ value, style }) => {
  const systemTokenCount = useTokenCount(value);
  if (!value || !systemTokenCount) return;

  return (
    <Tag
      style={{
        marginTop: 24,
        width: 'fit-content',
        ...style,
      }}
    >
      Token: {systemTokenCount}
    </Tag>
  );
});

export default Tokens;
