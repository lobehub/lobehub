import fs from 'fs-extra';
import { execSync } from 'node:child_process';
import path from 'node:path';

import { runPrebuild } from '../prebuild.mjs';
import { modifySourceForElectron } from './modifiers/index.mjs';

const PROJECT_ROOT = process.cwd();
const TEMP_DIR = path.join(PROJECT_ROOT, 'tmp', 'desktop-build');

const foldersToSymlink = [
  'node_modules',
  'packages',
  'public',
  'locales',
  'docs',
  '.cursor',
  'apps',
];

const foldersToCopy = ['src', 'scripts'];

const filesToCopy = [
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'pnpm-workspace.yaml',
  'bun.lockb',
  '.npmrc',
  '.bunfig.toml',
  '.eslintrc.js',
  '.eslintignore',
  '.prettierrc.cjs',
  '.prettierignore',
  'drizzle.config.ts',
  'postcss.config.js',
  'tailwind.config.ts',
  'tailwind.config.js',
];

const build = async () => {
  console.log('🚀 Starting Electron App Build in Shadow Workspace...');
  console.log(`📂 Workspace: ${TEMP_DIR}`);

  if (fs.existsSync(TEMP_DIR)) {
    await fs.remove(TEMP_DIR);
  }
  await fs.ensureDir(TEMP_DIR);

  console.log('🔗 Symlinking dependencies and static assets...');
  for (const folder of foldersToSymlink) {
    const srcPath = path.join(PROJECT_ROOT, folder);
    const destPath = path.join(TEMP_DIR, folder);
    if (fs.existsSync(srcPath)) {
      await fs.ensureSymlink(srcPath, destPath);
    }
  }

  console.log('📋 Copying source code...');
  for (const folder of foldersToCopy) {
    const srcPath = path.join(PROJECT_ROOT, folder);
    const destPath = path.join(TEMP_DIR, folder);
    if (fs.existsSync(srcPath)) {
      await fs.copy(srcPath, destPath);
    }
  }

  console.log('📄 Copying configuration files...');
  const allFiles = await fs.readdir(PROJECT_ROOT);
  const envFiles = allFiles.filter((f) => f.startsWith('.env'));
  const files = [...filesToCopy, ...envFiles];
  for (const file of files) {
    const srcPath = path.join(PROJECT_ROOT, file);
    const destPath = path.join(TEMP_DIR, file);
    if (fs.existsSync(srcPath)) {
      await fs.copy(srcPath, destPath);
    }
  }

  console.log('✂️  Pruning desktop-incompatible code...');
  const relativeTempSrc = path.relative(PROJECT_ROOT, path.join(TEMP_DIR, 'src'));
  await runPrebuild(relativeTempSrc);

  await modifySourceForElectron(TEMP_DIR);

  console.log('🏗  Running next build in shadow workspace...');
  try {
    execSync('next build --webpack', {
      cwd: TEMP_DIR,
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=8192',
      },
      stdio: 'inherit',
    });

    console.log('📦 Extracting build artifacts...');
    const sourceOutDir = path.join(TEMP_DIR, 'out');
    const targetOutDir = path.join(PROJECT_ROOT, 'out');

    // Clean up target directories
    if (fs.existsSync(targetOutDir)) {
      await fs.remove(targetOutDir);
    }

    if (fs.existsSync(sourceOutDir)) {
      console.log('📦 Moving "out" directory...');
      await fs.move(sourceOutDir, targetOutDir);
    } else {
      console.warn("⚠️ 'out' directory not found. Using '.next' instead (fallback)?");
      const sourceNextDir = path.join(TEMP_DIR, '.next');
      const targetNextDir = path.join(PROJECT_ROOT, '.next');
      if (fs.existsSync(targetNextDir)) {
        await fs.remove(targetNextDir);
      }
      if (fs.existsSync(sourceNextDir)) {
        await fs.move(sourceNextDir, targetNextDir);
      }
    }

    console.log('✅ Build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed.');
    throw error;
  } finally {
    console.log('🧹 Cleaning up workspace...');
    await fs.remove(TEMP_DIR);
  }
};

await build().catch((err) => {
  console.error(err);
  throw err;
});
