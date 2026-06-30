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
  const modified = original.replace(/\/\/\s*@ts-ignore/g, '// @ts-expect-error');
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
