#!/usr/bin/env bash
set -euo pipefail

BRAND_NAME="Chinna"
ORG_NAME_VALUE="Project-M"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".backup-chinna-branding-safe-$STAMP"

echo "STRICT SAFE SOURCE BRANDING PATCH"
echo "Brand: $BRAND_NAME"
echo "Org: $ORG_NAME_VALUE"
echo "Backup: $BACKUP_DIR"
echo ""

if [ ! -f package.json ] || [ ! -d src ]; then
  echo "ERROR: Run this from the ChinnaHub/LobeHub project root."
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
  src/components/BrandWatermark/index.tsx \
  src/components/Branding/WelcomeLogo/LobeChat.tsx \
  src/components/Branding/WelcomeLogo/Custom.tsx \
  src/app/manifest.ts \
  src/app/metadata.ts \
  src/app/'[variants]'/metadata.ts
do
  backup_if_exists "$f"
done

echo "1) Updating central branding constants..."
mkdir -p src/const
cat > src/const/branding.ts <<EOF
export const BRANDING_NAME = '$BRAND_NAME';
export const ORG_NAME = '$ORG_NAME_VALUE';
EOF

echo "2) Patching UI branding files only..."
python3 <<'PY'
from pathlib import Path

targets = [
    "src/components/Branding/OrgBrand/index.tsx",
    "src/components/BrandWatermark/index.tsx",
    "src/components/Branding/WelcomeLogo/LobeChat.tsx",
    "src/components/Branding/WelcomeLogo/Custom.tsx",
    "src/app/manifest.ts",
    "src/app/metadata.ts",
    "src/app/[variants]/metadata.ts",
]

replacements = {
    "Chinna": "Chinna",
    "LobeAI": "Chinna",
    "LobeChat": "Chinna",
    "Lobe Chat": "Chinna",
    "LobeHub": "Project-M",
    "Lobe Hub": "Project-M",
}

for target in targets:
    p = Path(target)
    if not p.exists():
        continue

    s = p.read_text(encoding="utf-8")

    for old, new in replacements.items():
        s = s.replace(old, new)

    p.write_text(s, encoding="utf-8")
    print(f"patched {target}")
PY

echo "3) Checking remaining branding references in selected UI files..."
grep -RInE "Chinna|LobeAI|LobeChat|Lobe Chat|LobeHub|Lobe Hub" \
  src/components/Branding \
  src/components/BrandWatermark \
  src/app \
  2>/dev/null || true

echo ""
echo "DONE."
echo "Backup saved at: $BACKUP_DIR"
echo "Next safe checks:"
echo "pnpm lint || true"
echo "pnpm build"
