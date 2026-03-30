import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const spaDir = path.resolve(root, 'public/_spa');
const distDirs = ['desktop', 'mobile'] as const;
const copyDirs = ['assets', 'i18n', 'vendor'] as const;

mkdirSync(spaDir, { recursive: true });

for (const distDir of distDirs) {
  for (const dir of copyDirs) {
    const sourceDir = path.resolve(root, `dist/${distDir}/${dir}`);
    const targetDir = path.resolve(spaDir, dir);

    if (!existsSync(sourceDir)) continue;

    cpSync(sourceDir, targetDir, { recursive: true });
    console.log(`Copied dist/${distDir}/${dir} -> public/_spa/${dir}`);
  }
}
