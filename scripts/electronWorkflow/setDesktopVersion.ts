import path from 'node:path';

import fs from 'fs-extra';

type ReleaseType = 'stable' | 'beta' | 'nightly' | 'canary';

// Get command line arguments for the script
const version = process.argv[2];
const releaseType = process.argv[3] as ReleaseType;

// Validate parameters
if (!version || !releaseType) {
  console.error(
    'Missing parameters. Usage: bun run setDesktopVersion.ts <version> <stable|beta|nightly|canary>',
  );
  process.exit(1);
}

if (!['stable', 'beta', 'nightly', 'canary'].includes(releaseType)) {
  console.error(
    `Invalid release type: ${releaseType}. Must be one of 'stable', 'beta', 'nightly', 'canary'.`,
  );
  process.exit(1);
}

// Get root directory
const rootDir = path.resolve(__dirname, '../..');

// Path to the desktop app package.json
const desktopPackageJsonPath = path.join(rootDir, 'apps/desktop/package.json');

/**
 * Distribution identity (white-label / private builds); unset keeps upstream's.
 *
 * `productName` is what Electron names the per-user data directory after, and
 * the shell reads that directory before any app code runs — so it has to be
 * right in the packaged manifest, which is this file. Same permanence as
 * DESKTOP_APP_ID: changing it after a release leaves existing installs on an
 * empty profile.
 *
 * `name` reaches Linux packages (deb/rpm package name, WM_CLASS), so it is
 * derived from the product name unless DESKTOP_PACKAGE_NAME pins it.
 */
const distributionName = process.env.DESKTOP_PRODUCT_NAME?.trim();
const brandName = distributionName || 'LobeHub';

const resolvePackageBaseName = () => {
  if (process.env.DESKTOP_PACKAGE_NAME) return process.env.DESKTOP_PACKAGE_NAME;
  if (!distributionName) return 'lobehub-desktop';

  const slug = distributionName
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/^-|-$/g, '');
  if (!slug) {
    console.error(
      `❌ DESKTOP_PRODUCT_NAME "${distributionName}" has no ASCII letters or digits to derive a package name from; set DESKTOP_PACKAGE_NAME.`,
    );
    process.exit(1);
  }
  return `${slug}-desktop`;
};

const packageBaseName = resolvePackageBaseName();
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
        packageJson.productName = brandName;
        packageJson.name = packageBaseName;
        console.log('🌟 Setting as Stable version.');
        break;
      }
      case 'beta': {
        packageJson.productName = `${brandName}-Beta`;
        packageJson.name = `${packageBaseName}-beta`;
        console.log('🧪 Setting as Beta version.');
        updateAppIcon('beta');
        break;
      }
      case 'nightly': {
        packageJson.productName = `${brandName}-Nightly`;
        packageJson.name = `${packageBaseName}-nightly`;
        console.log('🌙 Setting as Nightly version.');
        updateAppIcon('nightly');
        break;
      }
      case 'canary': {
        packageJson.productName = brandName;
        packageJson.name = `${packageBaseName}-canary`;
        console.log('🐤 Setting as Canary version (same app name and icon as stable).');
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
