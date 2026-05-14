'use client';

import type { CSSProperties, HTMLAttributes } from 'react';
import { memo } from 'react';

import { ORG_NAME } from '@/const/branding';

interface BrandWatermarkProps extends HTMLAttributes<HTMLDivElement> {
  style?: CSSProperties;
}

const BrandWatermark = memo<BrandWatermarkProps>(({ style, ...rest }) => {
  return (
    <div
      style={{
        alignItems: 'center',
        color: 'var(--color-text-secondary, rgba(255,255,255,.55))',
        display: 'inline-flex',
        flex: 'none',
        fontSize: 12,
        gap: 4,
        lineHeight: 1,
        ...style,
      }}
      {...rest}
    >
      <span>Powered by</span>
      <strong style={{ fontWeight: 700 }}>{ORG_NAME}</strong>
    </div>
  );
});

BrandWatermark.displayName = 'BrandWatermark';

export default BrandWatermark;
