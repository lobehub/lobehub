#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".backup-fix-no-lobehub-ui-brand-import-$STAMP"

echo "FIXING BRANDING COMPONENTS WITHOUT @lobehub/ui/brand IMPORT"
echo "Backup: $BACKUP_DIR"
echo ""

if [ ! -f package.json ] || [ ! -d src ]; then
  echo "ERROR: Run this from the project root."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

backup_if_exists() {
  local f="$1"
  if [ -f "$f" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp "$f" "$BACKUP_DIR/$f"
  fi
}

for f in \
  src/const/branding.ts \
  src/components/Branding/OrgBrand/index.tsx \
  src/components/Branding/ProductLogo/index.tsx \
  src/components/Branding/ProductLogo/Custom.tsx \
  src/components/BrandWatermark/index.tsx
do
  backup_if_exists "$f"
done

echo "1) Ensuring branding constants..."
mkdir -p src/const
cat > src/const/branding.ts <<'EOF'
export const BRANDING_NAME = 'Chinna';
export const ORG_NAME = 'Project-M';
EOF

echo "2) Rewriting OrgBrand with no @lobehub/ui/brand dependency..."
mkdir -p src/components/Branding/OrgBrand
cat > src/components/Branding/OrgBrand/index.tsx <<'EOF'
import type { CSSProperties, HTMLAttributes } from 'react';
import { memo } from 'react';

import { ORG_NAME } from '@/const/branding';

interface OrgBrandProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number | string;
  type?: string;
  style?: CSSProperties;
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
EOF

echo "3) Rewriting ProductLogo with no @lobehub/ui/brand dependency..."
mkdir -p src/components/Branding/ProductLogo
cat > src/components/Branding/ProductLogo/index.tsx <<'EOF'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { memo } from 'react';

import { BRANDING_NAME } from '@/const/branding';

interface ProductLogoProps extends HTMLAttributes<HTMLSpanElement> {
  extra?: ReactNode;
  mobile?: boolean;
  size?: number | string;
  style?: CSSProperties;
  type?: string;
}

const ProductLogo = memo<ProductLogoProps>(({ extra, size = 32, type, style, ...rest }) => {
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

echo "4) Rewriting ProductLogo Custom with no @lobehub/ui/brand dependency..."
mkdir -p src/components/Branding/ProductLogo
cat > src/components/Branding/ProductLogo/Custom.tsx <<'EOF'
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
EOF

echo "5) Rewriting BrandWatermark with no @lobehub/ui/brand dependency..."
mkdir -p src/components/BrandWatermark
cat > src/components/BrandWatermark/index.tsx <<'EOF'
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
EOF

echo "6) Checking no forbidden brand package imports remain in patched branding files..."
grep -RIn "@lobehub/ui/brand" \
  src/components/Branding/OrgBrand \
  src/components/Branding/ProductLogo \
  src/components/BrandWatermark \
  2>/dev/null && {
    echo "ERROR: @lobehub/ui/brand still exists in patched files."
    exit 1
  } || true

echo ""
echo "DONE."
echo "Backup saved at: $BACKUP_DIR"
echo ""
echo "Now run:"
echo "pnpm build"
