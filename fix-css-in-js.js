const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!p.includes('node_modules') && !p.includes('.git')) walk(p, callback);
    } else {
      if (p.endsWith('.ts') || p.endsWith('.tsx')) {
        callback(p);
      }
    }
  });
}

let count = 0;
const updateFile = (p) => {
  const original = fs.readFileSync(p, 'utf8');
  if (!original.includes('createStyles')) return;
  let newText = original;
  newText = newText.replace(/createStyles\(\s*\(\{\s*css\s*,\s*token\s*\}\)\s*=>/g, 'createStaticStyles(({ css }) =>');
  newText = newText.replace(/createStyles\(\s*\(\{\s*token\s*,\s*css\s*\}\)\s*=>/g, 'createStaticStyles(({ css }) =>');
  if (newText !== original) {
    newText = newText.replace(/\btoken\./g, 'cssVar.');
    newText = newText.replace(/import\s+\{([^}]*)createStyles([^}]*)\}\s+from\s+['"]antd-style['"]/, (match, p1, p2) => {
      if (!p1.includes('createStaticStyles') && !p2.includes('createStaticStyles')) {
         return `import { ${p1}createStaticStyles, cssVar${p2.replace(/,\s*$/, '')} } from 'antd-style'`;
      }
      return match;
    });
    fs.writeFileSync(p, newText);
    count++;
    console.log("Modified:", p);
  }
};

walk('src', updateFile);
console.log("Done. Modified", count, "files.");
