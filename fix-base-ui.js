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
  let newText = original;
  // Look for: import { ... DropdownMenu ... } from '@lobehub/ui'
  // and we specifically only move DropdownMenu, Popover, ScrollArea, Switch, Toast
  // A simple regex approach that splits it into two imports if mixed, or just renames if it's the only ones.
  // For simplicity, since the codebase often uses `import { X, Y } from '@lobehub/ui'`, doing it safely with regex is hard.
  // Let's just find `import { Popover } from '@lobehub/ui'` exactly, or `import { Switch } from '@lobehub/ui'`.
  const primitives = ['Popover', 'Switch', 'DropdownMenu', 'ScrollArea', 'Toast'];
  
  for (const prim of primitives) {
    const r1 = new RegExp(`import\\s+\\{\\s*${prim}\\s*\\}\\s+from\\s+['"]@lobehub/ui['"]`, 'g');
    if (newText.match(r1)) {
       newText = newText.replace(r1, `import { ${prim} } from '@lobehub/ui/base-ui'`);
    }
  }

  if (original !== newText) {
    fs.writeFileSync(p, newText);
    count++;
    console.log("Modified:", p);
  }
};

walk('src', updateFile);
console.log("Done. Modified", count, "files.");
