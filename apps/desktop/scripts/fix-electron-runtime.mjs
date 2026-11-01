#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const appRoot = path.join(import.meta.dirname, '..');
const force = process.argv.includes('--force');

const log = (message) => console.log(`[fix-electron-runtime] ${message}`);
const fail = (message) => {
  console.error(`[fix-electron-runtime] ${message}`);
  process.exit(1);
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });

  if (result.error) throw result.error;

  return result;
};

const getElectronPackageDir = () => {
  const electronPackageJson = require.resolve('electron/package.json', { paths: [appRoot] });

  return path.dirname(electronPackageJson);
};

const getPlatformPath = (platform) => {
  switch (platform) {
    case 'darwin':
    case 'mas': {
      return 'Electron.app/Contents/MacOS/Electron';
    }
    case 'freebsd':
    case 'linux':
    case 'openbsd': {
      return 'electron';
    }
    case 'win32': {
      return 'electron.exe';
    }
    default: {
      fail(`Unsupported Electron platform: ${platform}`);
    }
  }
};

const getArch = (platform) => {
  const configuredArch = process.env.npm_config_arch;

  if (configuredArch) return configuredArch;

  if (platform === 'darwin' && process.platform === 'darwin' && process.arch === 'x64') {
    const rosetta = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (rosetta.stdout.trim() === '1') return 'arm64';
  }

  return process.arch;
};

const isElectronInstalled = (electronDir, version, platformPath) => {
  try {
    const installedVersion = readFileSync(
      path.join(electronDir, 'dist', 'version'),
      'utf8',
    ).replace(/^v/, '');
    const installedPath = readFileSync(path.join(electronDir, 'path.txt'), 'utf8');

    return (
      installedVersion === version &&
      installedPath === platformPath &&
      existsSync(path.join(electronDir, 'dist', platformPath))
    );
  } catch {
    return false;
  }
};

const verifyElectron = () => {
  const electronCli = require.resolve('electron/cli.js', { paths: [appRoot] });
  const result = run(process.execPath, [electronCli, '--version']);

  return result.status === 0 ? result.stdout.trim() : undefined;
};

const extractZip = (zipPath, distPath) => {
  mkdirSync(distPath, { recursive: true });

  if (process.platform === 'darwin') {
    const ditto = run('/usr/bin/ditto', ['-x', '-k', zipPath, distPath], { stdio: 'inherit' });

    if (ditto.status !== 0) fail(`ditto extraction failed with exit code ${ditto.status}`);
    return;
  }

  if (process.platform === 'win32') {
    const powershell = run(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(distPath)} -Force`,
      ],
      { stdio: 'inherit' },
    );

    if (powershell.status !== 0)
      fail(`PowerShell extraction failed with exit code ${powershell.status}`);
    return;
  }

  const unzip = run('unzip', ['-q', '-o', zipPath, '-d', distPath], { stdio: 'inherit' });

  if (unzip.status !== 0) fail(`unzip extraction failed with exit code ${unzip.status}`);
};

const main = async () => {
  const electronDir = getElectronPackageDir();
  const electronRequire = createRequire(path.join(electronDir, 'install.js'));
  const { downloadArtifact } = electronRequire('@electron/get');
  const electronPackage = electronRequire('./package.json');
  const platform = process.env.npm_config_platform || process.platform;
  const arch = getArch(platform);
  const platformPath = getPlatformPath(platform);

  if (!force && isElectronInstalled(electronDir, electronPackage.version, platformPath)) {
    const electronVersion = verifyElectron();

    if (electronVersion) {
      log(`Electron runtime is already installed: ${electronVersion}`);
      return;
    }
  }

  log(`Repairing electron@${electronPackage.version} for ${platform}-${arch}`);

  const zipPath = await downloadArtifact({
    arch,
    artifactName: 'electron',
    cacheRoot: process.env.electron_config_cache,
    checksums:
      process.env.electron_use_remote_checksums ||
      process.env.npm_config_electron_use_remote_checksums
        ? undefined
        : electronRequire('./checksums.json'),
    force: true,
    platform,
    version: electronPackage.version,
  });

  log(`Downloaded artifact: ${zipPath}`);

  const distPath = path.join(electronDir, 'dist');
  extractZip(zipPath, distPath);
  writeFileSync(path.join(electronDir, 'path.txt'), platformPath);

  const electronVersion = verifyElectron();

  if (!electronVersion) fail('Electron runtime verification failed after repair');

  log(`Electron runtime repaired: ${electronVersion}`);
};

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
});
