import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { generateDensityTokenFiles } from './densityTokensCore.ts';

const root = path.resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');

const files = generateDensityTokenFiles(root);
const stale = files.filter((file) => {
  try {
    return readFileSync(file.filePath, 'utf8') !== file.content;
  } catch {
    return true;
  }
});

if (check) {
  if (stale.length === 0) {
    console.log('✅ density tokens are in sync with src/styles/densityScale.ts');
    process.exit(0);
  }

  console.error(
    `❌ density tokens are stale: ${stale.map((file) => file.relativePath).join(', ')}\n` +
      `   Run \`pnpm gen:density\` and commit the result.`,
  );
  process.exit(1);
}

if (stale.length === 0) {
  console.log('✅ density tokens already up to date');
  process.exit(0);
}

for (const file of stale) {
  writeFileSync(file.filePath, file.content);
  console.log(`✍️  wrote ${file.relativePath}`);
}
