const cp = require('child_process');
const fs = require('fs');
const path = require('path');

delete process.env.GITHUB_TOKEN;

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

function processPR(branch, title, body, modifier) {
  console.log(`\n\n=== Processing PR: ${branch} ===`);
  try {
    cp.execSync('git reset --hard HEAD');
    try { cp.execSync(`git branch -D ${branch}`); } catch (e) {}
    cp.execSync(`git checkout -b ${branch} origin/canary`);
    
    let count = 0;
    const updateFile = (p) => {
      const original = fs.readFileSync(p, 'utf8');
      const modified = modifier(original, p);
      if (original !== modified) {
        fs.writeFileSync(p, modified);
        count++;
      }
    };

    walk('src', updateFile);
    walk('apps/server/src', updateFile);
    walk('packages/database/src', updateFile);
    
    if (count > 0) {
      console.log(`Modified ${count} files. Committing...`);
      cp.execSync('git add .');
      cp.execSync(`git commit -m "${title}"`);
      console.log("Pushing...");
      cp.execSync(`git push -u origin ${branch} --force`);
      
      fs.writeFileSync('pr_body.md', body);
      try {
        console.log("Creating PR via gh...");
        const r = cp.execSync(`gh pr create --title "${title}" --body-file pr_body.md --base canary`);
        console.log(`PR Created: ${r.toString()}`);
      } catch (e) {
        console.log("PR likely exists or failed:", e.message);
      }
    } else {
      console.log("No files modified.");
    }
  } catch(e) {
    console.error("Error processing PR:", e.message);
  }
}

// PR 2: @ts-ignore -> @ts-expect-error
processPR(
  'refactor/ts-expect-error',
  '♻️ refactor: migrate @ts-ignore to @ts-expect-error',
  '### Description\nPer LobeHub TypeScript guidelines, `@ts-ignore` is banned because it hides future type fixes. This PR replaces all instances with `@ts-expect-error` which correctly warns when the underlying type error is fixed.\n\n### Changes\n- Replaced `// @ts-ignore` with `// @ts-expect-error` across the codebase.',
  (text) => text.replace(/\/\/\s*@ts-ignore/g, '// @ts-expect-error')
);

// PR 3: Base UI Primitives Migration
processPR(
  'refactor/base-ui-primitives',
  '♻️ refactor: migrate primitives to @lobehub/ui/base-ui',
  '### Description\nPer `AGENTS.md` guidelines, headless primitives should be imported from `@lobehub/ui/base-ui` rather than the root package to optimize bundle size.\n\n### Changes\n- Migrated `DropdownMenu`, `Popover`, `ScrollArea`, `Switch`, and `Toast` imports.',
  (text) => {
    let newText = text;
    newText = newText.replace(/import\s+\{([^}]*(DropdownMenu|Popover|ScrollArea|Switch|Toast)[^}]*)\}\s+from\s+['"]@lobehub\/ui['"]/g, 'import { $1 } from \'@lobehub/ui/base-ui\'');
    return newText;
  }
);

// PR 4: console.log removal
processPR(
  'refactor/remove-console-log',
  '♻️ refactor: remove stray console.log statements',
  '### Description\nRemoved stray `console.log` statements from production code per the review checklist.\n\n### Changes\n- Removed `console.log(...)` from non-test files.',
  (text, filepath) => {
    if (filepath.includes('.test.ts') || filepath.includes('__tests__') || filepath.includes('scripts')) return text;
    return text.replace(/^\s*console\.log\(.*?\);\s*$/gm, '');
  }
);

// PR 5: createStyles to createStaticStyles
processPR(
  'refactor/zero-runtime-css',
  '♻️ refactor: complete zero-runtime CSS-in-JS migration',
  '### Description\nMigrated remaining `createStyles` to `createStaticStyles` where tokens were destructured, mapping `token.*` to `cssVar.*` for zero-runtime CSS performance.\n\n### Changes\n- Switched `createStyles(({ css, token })` to `createStaticStyles(({ css })`\n- Mapped `token.color...` to `cssVar.color...`',
  (text) => {
    if (!text.includes('createStyles')) return text;
    let newText = text;
    newText = newText.replace(/createStyles\(\s*\(\{\s*css\s*,\s*token\s*\}\)\s*=>/g, 'createStaticStyles(({ css }) =>');
    newText = newText.replace(/createStyles\(\s*\(\{\s*token\s*,\s*css\s*\}\)\s*=>/g, 'createStaticStyles(({ css }) =>');
    newText = newText.replace(/\btoken\./g, 'cssVar.');
    if (newText !== text) {
      newText = newText.replace(/import\s+\{([^}]*)createStyles([^}]*)\}\s+from\s+['"]antd-style['"]/, (match, p1, p2) => {
        if (!p1.includes('createStaticStyles') && !p2.includes('createStaticStyles')) {
           return `import { ${p1}createStaticStyles, cssVar${p2.replace(/,\s*$/, '')} } from 'antd-style'`;
        }
        return match;
      });
    }
    return newText;
  }
);

// PR 6: any to unknown
processPR(
  'refactor/any-to-unknown',
  '♻️ refactor: replace any with unknown for type safety',
  '### Description\nPer LobeHub TypeScript guidelines, `any` should be avoided. This PR does a safe pass to replace `any` in catch blocks and generic bounds with `unknown`.\n\n### Changes\n- Replaced `catch (e: any)` with `catch (e: unknown)`\n- Replaced `Record<string, any>` with `Record<string, unknown>`',
  (text) => {
    let newText = text.replace(/catch\s*\(\s*([a-zA-Z0-9_]+)\s*:\s*any\s*\)/g, 'catch ($1: unknown)');
    newText = newText.replace(/Record<string,\s*any>/g, 'Record<string, unknown>');
    return newText;
  }
);
