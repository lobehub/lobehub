import path from 'node:path';

import fs from 'fs-extra';

const rootDir = path.resolve(__dirname, '../..');

const exportSourceDir = path.join(rootDir, 'out');
const exportTargetDir = path.join(rootDir, 'apps/desktop/dist/next');

if (fs.existsSync(exportSourceDir)) {
  console.log(`📦 Copying Next export assets from ${exportSourceDir} to ${exportTargetDir}...`);
  fs.ensureDirSync(exportTargetDir);
  fs.copySync(exportSourceDir, exportTargetDir, { overwrite: true });
  console.log(`✅ Export assets copied successfully!`);
} else {
  console.log(`ℹ️ No Next export output found at ${exportSourceDir}, skipping copy.`);
}

console.log(`🎉 Export move completed!`);
