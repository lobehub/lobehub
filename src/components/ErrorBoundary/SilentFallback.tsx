'use client';

import { Icon } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { TriangleAlert } from 'lucide-react';
import { type CSSProperties, memo } from 'react';

interface SilentFallbackProps {
  minHeight?: number;
  style?: CSSProperties;
}

const SilentFallback = memo<SilentFallbackProps>(({ minHeight = 36, style }) => {
  const theme = useTheme();

  return (
    <div
      style={{
        alignItems: 'center',
        border: `1px dashed ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadiusSM,
        color: theme.colorTextQuaternary,
        display: 'flex',
        fontSize: 12,
        gap: 4,
        justifyContent: 'center',
        minHeight,
        ...style,
      }}
    >
      <Icon icon={TriangleAlert} size={'small'} />
      <span>Render Error</span>
    </div>
  );
});

SilentFallback.displayName = 'SilentFallback';

export default SilentFallback;
