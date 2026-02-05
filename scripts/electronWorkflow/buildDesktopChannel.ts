import { execSync } from 'node:child_process';
import path from 'node:path';

import fs from 'fs-extra';

type ReleaseChannel = 'stable' | 'beta' | 'nightly';

const rootDir = path.resolve(__dirname, '../..');
const desktopDir = path.join(rootDir, 'apps/desktop');
const desktopPackageJsonPath = path.join(desktopDir, 'package.json');
const buildDir = path.join(desktopDir, 'build');

const iconTargets = ['icon.png', 'Icon.icns', 'icon.ico'];

const isFlag = (value: string) => value.startsWith('-');

const parseArgs = (args: string[]) => {
  let channel = '';
  let version = '';
  let keepChanges = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--channel' || arg === '-c') {
      channel = args[i + 1] ?? '';
      i += 1;
      continue;
    }

    if (arg === '--version' || arg === '-v') {
      version = args[i + 1] ?? '';
      i += 1;
      continue;
    }

    if (arg === '--keep-changes') {
      keepChanges = true;
      continue;
    }

    if (!isFlag(arg)) {
      if (!channel) {
        channel = arg;
        continue;
      }

      if (!version) {
        version = arg;
      }
    }
  }

  return { channel, keepChanges, version };
};

const resolveDefaultVersion = () => {
  const rootPackageJsonPath = path.join(rootDir, 'package.json');
  const rootPackageJson = fs.readJsonSync(rootPackageJsonPath);
  return rootPackageJson.version as string | undefined;
};

const backupFile = async (filePath: string) => {
  try {
    return await fs.readFile(filePath);
  } catch {
    return undefined;
  }
};

const restoreFile = async (filePath: string, content?: Buffer) => {
  if (!content) return;
  await fs.writeFile(filePath, content);
};

const validateChannel = (channel: string): channel is ReleaseChannel =>
  channel === 'stable' || channel === 'beta' || channel === 'nightly';

const runCommand = (command: string, env?: Record<string, string | undefined>) => {
  execSync(command, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
};

const main = async () => {
  const { channel, version: rawVersion, keepChanges } = parseArgs(process.argv.slice(2));

  if (!validateChannel(channel)) {
    console.error(
      'Missing or invalid channel. Usage: npm run desktop:build-channel -- <stable|beta|nightly> [version] [--keep-changes]',
    );
    process.exit(1);
  }

  const version = rawVersion || resolveDefaultVersion();

  if (!version) {
    console.error('Missing version. Provide it or ensure root package.json has a version.');
    process.exit(1);
  }

  const packageJsonBackup = await backupFile(desktopPackageJsonPath);
  const iconBackups = await Promise.all(
    iconTargets.map(async (fileName) => ({
      content: await backupFile(path.join(buildDir, fileName)),
      fileName,
    })),
  );

  console.log(`🚦 CI-style build channel: ${channel}`);
  console.log(`🏷️  Desktop version: ${version}`);
  console.log(`🧩 Keep local changes: ${keepChanges ? 'yes' : 'no'}`);

  try {
    runCommand(`npm run workflow:set-desktop-version ${version} ${channel}`);
    runCommand('npm run desktop:package:app', { UPDATE_CHANNEL: channel });
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  } finally {
    if (!keepChanges) {
      await restoreFile(desktopPackageJsonPath, packageJsonBackup);
      await Promise.all(
        iconBackups.map(({ fileName, content }) =>
          restoreFile(path.join(buildDir, fileName), content),
        ),
      );
      console.log('🧹 Restored local desktop package metadata and icons.');
    }
  }
};

main();
