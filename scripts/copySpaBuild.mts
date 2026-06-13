import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const copyDirs = ['assets', 'i18n', 'vendor'] as const;
const targets = [
  { distDir: 'desktop', publicDir: 'public/_spa' },
  { distDir: 'mobile', publicDir: 'public/_spa' },
  { distDir: 'auth', publicDir: 'public/_spa-auth' },
] as const;

for (const { distDir, publicDir } of targets) {
  const spaDir = path.resolve(root, publicDir);
  mkdirSync(spaDir, { recursive: true });

  for (const dir of copyDirs) {
    const sourceDir = path.resolve(root, `dist/${distDir}/${dir}`);
    const targetDir = path.resolve(spaDir, dir);

    if (!existsSync(sourceDir)) continue;

    cpSync(sourceDir, targetDir, { recursive: true });
    console.log(`Copied dist/${distDir}/${dir} -> ${publicDir}/${dir}`);
  }
}
