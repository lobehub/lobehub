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
  if (p.includes('.test.') || p.includes('__tests__') || p.includes('scripts')) return;
  const original = fs.readFileSync(p, 'utf8');
  const modified = original.replace(/^\s*console\.log\(.*?\);\s*$/gm, '');
  if (original !== modified) {
    fs.writeFileSync(p, modified);
    count++;
    console.log("Modified:", p);
  }
};

walk('src', updateFile);
walk('apps/server/src', updateFile);
walk('packages', updateFile);
console.log("Done. Modified", count, "files.");
