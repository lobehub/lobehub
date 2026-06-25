import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const copyDirs = ['assets', 'i18n', 'vendor'] as const;
const copyRootFilePatterns = [/^favicon.*\.ico$/, /^apple-touch-icon\.png$/] as const;
const targets = [
  { distDir: 'desktop', publicDir: 'public/_spa' },
  { distDir: 'mobile', publicDir: 'public/_spa' },
  { distDir: 'auth', publicDir: 'public/_spa-auth' },
] as const;

for (const { distDir, publicDir } of targets) {
  const distRoot = path.resolve(root, `dist/${distDir}`);
  const spaDir = path.resolve(root, publicDir);
  mkdirSync(spaDir, { recursive: true });

  for (const dir of copyDirs) {
    const sourceDir = path.resolve(distRoot, dir);
    const targetDir = path.resolve(spaDir, dir);

    if (!existsSync(sourceDir)) continue;

    cpSync(sourceDir, targetDir, { recursive: true });
    console.log(`Copied dist/${distDir}/${dir} -> ${publicDir}/${dir}`);
  }

  if (!existsSync(distRoot)) continue;

  for (const file of readdirSync(distRoot)) {
    const sourceFile = path.resolve(distRoot, file);

    if (!statSync(sourceFile).isFile()) continue;
    if (!copyRootFilePatterns.some((pattern) => pattern.test(file))) continue;

    cpSync(sourceFile, path.resolve(spaDir, file));
    console.log(`Copied dist/${distDir}/${file} -> ${publicDir}/${file}`);
  }
}
