#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".backup-fix-chinna-branding-types-$STAMP"

echo "FIXING BROKEN BRANDING TYPE/IMPORT NAMES"
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
  src/components/Branding/OrgBrand/index.tsx \
  src/components/Branding/ProductLogo/index.tsx \
  src/components/Branding/ProductLogo/Custom.tsx \
  src/components/BrandWatermark/index.tsx
do
  backup_if_exists "$f"
done

echo "1) Restoring invalid TypeScript identifiers only..."
python3 <<'PY'
from pathlib import Path

targets = [
    Path("src/components/Branding/OrgBrand/index.tsx"),
    Path("src/components/Branding/ProductLogo/index.tsx"),
    Path("src/components/Branding/ProductLogo/Custom.tsx"),
    Path("src/components/BrandWatermark/index.tsx"),
]

fixes = {
    "Project-MProps": "LobeHubProps",
    "ChinnaProps": "LobeChatProps",
    "type Project-MProps": "type LobeHubProps",
    "type ChinnaProps": "type LobeChatProps",
}

for p in targets:
    if not p.exists():
        continue

    s = p.read_text(encoding="utf-8")

    for old, new in fixes.items():
        s = s.replace(old, new)

    p.write_text(s, encoding="utf-8")
    print(f"fixed {p}")
PY

echo ""
echo "2) Rewriting OrgBrand safely..."
cat > src/components/Branding/OrgBrand/index.tsx <<'EOF'
import { LobeHub, type LobeHubProps } from '@lobehub/ui/brand';
import { memo } from 'react';

import { ORG_NAME } from '@/const/branding';
import { isCustomORG } from '@/const/version';

export const OrgBrand = memo<LobeHubProps>((props) => {
  if (isCustomORG) {
    return <span>{ORG_NAME}</span>;
  }

  return <LobeHub {...props} />;
});

OrgBrand.displayName = 'OrgBrand';

export default OrgBrand;
EOF

echo ""
echo "3) Rewriting ProductLogo safely with UI-only custom text..."
cat > src/components/Branding/ProductLogo/index.tsx <<'EOF'
import { type LobeHubProps } from '@lobehub/ui/brand';
import { memo } from 'react';

import { BRANDING_NAME } from '@/const/branding';
import { isCustomBranding } from '@/const/version';

interface ProductLogoProps extends LobeHubProps {
  mobile?: boolean;
}

const ProductLogo = memo<ProductLogoProps>(({ size = 32, type, style, ...rest }) => {
  if (isCustomBranding) {
    return (
      <span
        style={{
          alignItems: 'center',
          display: 'inline-flex',
          fontSize: typeof size === 'number' ? Math.max(16, Math.round(size * 0.58)) : 18,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          ...style,
        }}
        {...rest}
      >
        {BRANDING_NAME}
      </span>
    );
  }

  const { LobeHub } = require('@lobehub/ui/brand');
  return <LobeHub size={size} type={type} style={style} {...rest} />;
});

ProductLogo.displayName = 'ProductLogo';

export default ProductLogo;
EOF

echo ""
echo "4) Confirming no invalid generated identifiers remain..."
grep -RInE "Project-MProps|ChinnaProps|type Project-MProps|type ChinnaProps" src/components src/app || true

echo ""
echo "DONE."
echo "Backup saved at: $BACKUP_DIR"
echo ""
echo "Now run:"
echo "pnpm build"
