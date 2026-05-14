#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".backup-chinna-product-logo-$STAMP"

echo "PATCHING PRODUCT LOGO UI ONLY"
echo "Backup: $BACKUP_DIR"
echo ""

if [ ! -f package.json ] || [ ! -d src ]; then
  echo "ERROR: Run this from the ChinnaHub project root."
  exit 1
fi

mkdir -p "$BACKUP_DIR/src/components/Branding/ProductLogo"

if [ -f src/components/Branding/ProductLogo/index.tsx ]; then
  cp src/components/Branding/ProductLogo/index.tsx "$BACKUP_DIR/src/components/Branding/ProductLogo/index.tsx"
fi

cat > src/components/Branding/ProductLogo/index.tsx <<'EOF'
import { memo } from 'react';

interface ProductLogoProps {
  className?: string;
  size?: number;
  style?: React.CSSProperties;
  type?: 'text' | 'combine' | 'symbol' | string;
}

const ProductLogo = memo<ProductLogoProps>(({ className, size = 32, style, type }) => {
  const showText = type !== 'symbol';

  return (
    <span
      className={className}
      style={{
        alignItems: 'center',
        display: 'inline-flex',
        fontSize: Math.max(14, Math.round(size * 0.52)),
        fontWeight: 700,
        gap: 8,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          alignItems: 'center',
          border: '1px solid currentColor',
          borderRadius: Math.round(size * 0.28),
          display: 'inline-flex',
          fontSize: Math.max(12, Math.round(size * 0.42)),
          fontWeight: 800,
          height: size,
          justifyContent: 'center',
          width: size,
        }}
      >
        C
      </span>

      {showText ? <span>Chinna</span> : null}
    </span>
  );
});

ProductLogo.displayName = 'ProductLogo';

export default ProductLogo;
EOF

echo "DONE."
echo "Backup saved at: $BACKUP_DIR"
echo ""
echo "Now run:"
echo "pnpm build"
