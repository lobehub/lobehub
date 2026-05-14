#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".backup-fix-productlogo-named-export-$STAMP"

echo "FIXING PRODUCTLOGO NAMED EXPORT"
echo "Backup: $BACKUP_DIR"
echo ""

if [ ! -f package.json ] || [ ! -d src ]; then
  echo "ERROR: Run this from the project root."
  exit 1
fi

mkdir -p "$BACKUP_DIR/src/components/Branding/ProductLogo"
cp src/components/Branding/ProductLogo/index.tsx "$BACKUP_DIR/src/components/Branding/ProductLogo/index.tsx"

cat > src/components/Branding/ProductLogo/index.tsx <<'EOF'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { memo } from 'react';

import { BRANDING_NAME } from '@/const/branding';

export interface ProductLogoProps extends HTMLAttributes<HTMLSpanElement> {
  extra?: ReactNode;
  mobile?: boolean;
  size?: number | string;
  style?: CSSProperties;
  type?: string;
}

export const ProductLogo = memo<ProductLogoProps>(({ extra, size = 32, type, style, ...rest }) => {
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

ProductLogo.displayName = 'ProductLogo';

export default ProductLogo;
EOF

echo "Checking export..."
grep -n "export const ProductLogo" src/components/Branding/ProductLogo/index.tsx

echo ""
echo "DONE."
echo "Backup saved at: $BACKUP_DIR"
echo ""
echo "Now run:"
echo "pnpm build"
