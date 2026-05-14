import type { CSSProperties, HTMLAttributes } from 'react';
import { memo } from 'react';

import { ORG_NAME } from '@/const/branding';

interface OrgBrandProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number | string;
  style?: CSSProperties;
  type?: string;
}

export const OrgBrand = memo<OrgBrandProps>(({ size = 20, type, style, ...rest }) => {
  const fontSize = typeof size === 'number' ? Math.max(14, Math.round(size * 0.58)) : size;

  return (
    <span
      aria-label={ORG_NAME}
      style={{
        alignItems: 'center',
        display: 'inline-flex',
        fontSize,
        fontWeight: 700,
        letterSpacing: '-0.03em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {ORG_NAME}
    </span>
  );
});

OrgBrand.displayName = 'OrgBrand';

export default OrgBrand;
