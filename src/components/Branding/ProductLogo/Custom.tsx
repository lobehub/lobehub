import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { memo } from 'react';

import { BRANDING_NAME } from '@/const/branding';

interface CustomLogoProps extends HTMLAttributes<HTMLSpanElement> {
  extra?: ReactNode;
  size?: number | string;
  style?: CSSProperties;
  type?: string;
}

const CustomLogo = memo<CustomLogoProps>(({ extra, size = 32, type, style, ...rest }) => {
  const fontSize = typeof size === 'number' ? Math.max(16, Math.round(size * 0.58)) : size;

  return (
    <span
      aria-label={BRANDING_NAME}
      style={{
        alignItems: 'center',
        display: 'inline-flex',
        fontSize,
        fontWeight: 800,
        gap: 6,
        letterSpacing: '-0.04em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {BRANDING_NAME}
      {extra}
    </span>
  );
});

CustomLogo.displayName = 'CustomLogo';

export default CustomLogo;
