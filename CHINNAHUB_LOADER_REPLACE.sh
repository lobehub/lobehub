#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".backup-chinnahub-loader-$STAMP"

echo "Replacing LobeHub loader with ChinnaHub loader"
echo "Backup: $BACKUP_DIR"

mkdir -p "$BACKUP_DIR"

backup_if_exists() {
  local f="$1"
  if [ -f "$f" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp "$f" "$BACKUP_DIR/$f"
  fi
}

SPA_TEMPLATE="src/app/spa/[variants]/[[...path]]/spaHtmlTemplates.ts"
BRAND_LOADING="src/components/Loading/BrandTextLoading/index.tsx"

backup_if_exists "$SPA_TEMPLATE"
backup_if_exists "$BRAND_LOADING"

echo "1) Replacing SPA boot loader logo/text..."

python3 <<'PY'
from pathlib import Path
import re

p = Path("src/app/spa/[variants]/[[...path]]/spaHtmlTemplates.ts")

if p.exists():
    s = p.read_text(encoding="utf-8")

    # Replace the entire loading-brand inner SVG area with a clean ChinnaHub text loader.
    s = re.sub(
        r'<div id=\\"loading-brand\\" aria-label=\\"Loading\\" role=\\"status\\">.*?</div>\\n    </div>',
        '''<div id=\\"loading-brand\\" aria-label=\\"Loading ChinnaHub\\" role=\\"status\\">
        <div id=\\"chinnahub-loader-mark\\">C</div>
        <div id=\\"chinnahub-loader-text\\">ChinnaHub</div>
      </div>
    </div>''',
        s,
        flags=re.S
    )

    # Replace old SVG animation CSS with ChinnaHub loader CSS.
    s = re.sub(
        r'#loading-brand svg path \{.*?html\[data-theme=\\\'dark\\\'\] #loading-brand \{\n        color: #f0f0f0;\n      \}',
        '''#chinnahub-loader-mark {
        width: 44px;
        height: 44px;
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        font: 800 24px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #fff;
        background: linear-gradient(135deg, #7c3aed, #06b6d4);
        box-shadow: 0 0 40px rgba(124, 58, 237, 0.45);
        animation: chinnahub-pulse 1.8s ease-in-out infinite;
      }
      #chinnahub-loader-text {
        font: 700 28px/1.1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: -0.04em;
      }
      @keyframes chinnahub-pulse {
        0%, 100% {
          transform: scale(1);
          opacity: 0.78;
        }
        50% {
          transform: scale(1.08);
          opacity: 1;
        }
      }
      html[data-theme=\\'dark\\'] #loading-brand {
        color: #f0f0f0;
      }''',
        s,
        flags=re.S
    )

    # Final text fallback replacements.
    s = s.replace("<title>LobeHub</title>", "<title>ChinnaHub</title>")
    s = s.replace("LobeHub", "ChinnaHub")
    s = s.replace("Lobe Hub", "ChinnaHub")

    p.write_text(s, encoding="utf-8")
    print("patched", p)
else:
    print("WARN: SPA template not found")
PY

echo "2) Replacing React BrandTextLoading component..."

cat > "$BRAND_LOADING" <<'EOF'
import { createStyles } from 'antd-style';
import { memo } from 'react';

interface BrandTextLoadingProps {
  debugId?: string;
}

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100%;
    height: 100%;
    min-height: 240px;

    display: flex;
    align-items: center;
    justify-content: center;
  `,
  brand: css`
    display: flex;
    align-items: center;
    gap: 12px;

    color: ${token.colorText};
    user-select: none;
  `,
  mark: css`
    width: 44px;
    height: 44px;
    border-radius: 14px;

    display: flex;
    align-items: center;
    justify-content: center;

    font-size: 24px;
    font-weight: 800;
    line-height: 1;
    color: #fff;

    background: linear-gradient(135deg, #7c3aed, #06b6d4);
    box-shadow: 0 0 40px rgba(124, 58, 237, 0.45);

    animation: chinnahub-pulse 1.8s ease-in-out infinite;

    @keyframes chinnahub-pulse {
      0%,
      100% {
        transform: scale(1);
        opacity: 0.78;
      }

      50% {
        transform: scale(1.08);
        opacity: 1;
      }
    }
  `,
  text: css`
    font-size: 28px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.04em;
  `,
}));

const BrandTextLoading = memo<BrandTextLoadingProps>(({ debugId }) => {
  const { styles } = useStyles();

  return (
    <div className={styles.container} data-debug-id={debugId}>
      <div aria-label="Loading ChinnaHub" className={styles.brand} role="status">
        <div className={styles.mark}>C</div>
        <div className={styles.text}>ChinnaHub</div>
      </div>
    </div>
  );
});

BrandTextLoading.displayName = 'BrandTextLoading';

export default BrandTextLoading;
EOF

echo "3) Checking remaining LobeHub loader references..."

grep -RIn "BrandLoading\|LobeHubText\|<title>LobeHub</title>\|id=\\\"loading-brand\\\"" \
  src/components/Loading \
  src/app/spa \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  2>/dev/null || true

echo ""
echo "DONE."
echo "Backup saved at: $BACKUP_DIR"
echo ""
echo "Now run:"
echo "rm -rf .next public/_spa dist/desktop"
echo "pnpm run dev"
