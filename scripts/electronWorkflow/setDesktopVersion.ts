import path from 'node:path';

import fs from 'fs-extra';

type ReleaseType = 'stable' | 'beta' | 'nightly' | 'canary' | 'HARDY';

// Get command line arguments for the script
const version = process.argv[2];
const rawReleaseType = process.argv[3];
const releaseType = rawReleaseType?.toLowerCase() as ReleaseType;

// Validate parameters
if (!version || !releaseType) {
  console.error(
    'Missing parameters. Usage: bun run setDesktopVersion.ts <version> <stable|beta|nightly|canary|Hardy>',
  );
  process.exit(1);
}

const validTypes = ['stable', 'beta', 'nightly', 'canary', 'hardy'];
if (!validTypes.includes(releaseType)) {
  console.error(
    `Invalid release type: ${rawReleaseType}. Must be one of 'stable', 'beta', 'nightly', 'canary', 'Hardy'.`,
  );
  process.exit(1);
}

// Get root directory
const rootDir = path.resolve(__dirname, '../..');

// Path to the desktop app package.json
const desktopPackageJsonPath = path.join(rootDir, 'apps/desktop/package.json');
const buildDir = path.join(rootDir, 'apps/desktop/build');

// Update app icon
function updateAppIcon(type: 'beta' | 'nightly') {
  console.log(`📦 Updating app icon for ${type} version...`);
  try {
    const iconSuffix = type === 'beta' ? 'beta' : 'nightly';
    const iconMappings = [
      { ext: '.png', source: `icon-${iconSuffix}.png`, target: 'icon.png' },
      { ext: '.icns', source: `Icon-${iconSuffix}.icns`, target: 'Icon.icns' },
      { ext: '.ico', source: `icon-${iconSuffix}.ico`, target: 'icon.ico' },
    ];

    for (const mapping of iconMappings) {
      const sourceFile = path.join(buildDir, mapping.source);
      const targetFile = path.join(buildDir, mapping.target);

      if (fs.existsSync(sourceFile)) {
        if (sourceFile !== targetFile) {
          fs.copyFileSync(sourceFile, targetFile);
          console.log(`  ✅ Copied ${mapping.source} to ${mapping.target}`);
        }
      } else {
        console.warn(`  ⚠️ Warning: Source icon not found: ${sourceFile}`);
      }
    }
  } catch (error) {
    console.error('  ❌ Error updating icons:', error);
    // Don't terminate the program, continue processing package.json
  }
}

function updatePackageJson() {
  console.log(`⚙️ Updating ${desktopPackageJsonPath} for ${releaseType} version ${version}...`);
  try {
    if (!fs.existsSync(desktopPackageJsonPath)) {
      console.error(`❌ Error: File not found ${desktopPackageJsonPath}`);
      process.exit(1);
    }

    const packageJson = fs.readJSONSync(desktopPackageJsonPath);

    // Always update the version number
    packageJson.version = version;

    // Modify other fields based on releaseType
    switch (releaseType) {
      case 'stable': {
        packageJson.productName = 'LobeHub';
        packageJson.name = 'lobehub-desktop';
        console.log('🌟 Setting as Stable version.');
        break;
      }
      case 'beta': {
        packageJson.productName = 'LobeHub-Beta';
        packageJson.name = 'lobehub-desktop-beta';
        console.log('🧪 Setting as Beta version.');
        updateAppIcon('beta');
        break;
      }
      case 'nightly': {
        packageJson.productName = 'LobeHub-Nightly';
        packageJson.name = 'lobehub-desktop-nightly';
        console.log('🌙 Setting as Nightly version.');
        updateAppIcon('nightly');
        break;
      }
      case 'canary': {
        packageJson.productName = 'LobeHub';
        packageJson.name = 'lobehub-desktop-canary';
        console.log('🐤 Setting as Canary version (same app name and icon as stable).');
        break;
      }
      case 'hardy': {
        packageJson.productName = 'LobeHub-Hardy';
        packageJson.name = 'lobehub-desktop-hardy';
        console.log('🔨 Setting as Hardy version.');
        break;
      }
    }

    // Write back to file
    fs.writeJsonSync(desktopPackageJsonPath, packageJson, { spaces: 2 });

    console.log(
      `✅ Desktop app package.json updated successfully for ${releaseType} version ${version}.`,
    );
  } catch (error) {
    console.error('❌ Error updating package.json:', error);
    process.exit(1);
  }
}

// Execute update
updatePackageJson();
