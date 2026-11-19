import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { copyExternalRuntimeModulesToSource } from './external-runtime-deps.config.mjs';
import { getModuleFilesConfig } from './module-deps.config.mjs';
import {
  buildFirstPartyNativeAddons,
  copyNativeModulesToSource,
  getAsarUnpackPatterns,
  getNativeModulesFilesConfig,
} from './native-deps.config.mjs';
import { notarizeMacApp } from './scripts/notarizeMacApp.mjs';
import { packBuiltinCore } from './scripts/packBuiltinCore.mjs';
import { toSparkleBuildVersion } from './scripts/sparkleBuildVersion.mjs';
import { resolveSparklePackaging } from './scripts/sparklePackaging.mjs';
import { verifyFontListSignature } from './scripts/verifyFontListSigning.mjs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const packageJSON = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8'));

const channel = process.env.UPDATE_CHANNEL;
const arch = os.arch();
const hasAppleCertificate = Boolean(process.env.CSC_LINK);

const macAppId = 'com.lobehub.lobehub-desktop';
// Communication notifications need the restricted
// `com.apple.developer.usernotifications.communication` entitlement, and
// macOS refuses to launch an app carrying it without a provisioning profile
// that authorizes it — so both must be applied together, and only when a
// profile is provided.
const macProvisioningProfile = process.env.MAC_PROVISIONING_PROFILE;
const macTeamId = process.env.APPLE_TEAM_ID;
const macCommunicationEntitlements =
  macProvisioningProfile && macTeamId
    ? path.join(__dirname, 'build', 'entitlements.mac.comm.generated.plist')
    : undefined;

if (macProvisioningProfile && !macTeamId) {
  console.warn(
    '⚠️ MAC_PROVISIONING_PROFILE is set but APPLE_TEAM_ID is missing — building without communication notification entitlements',
  );
}

if (macCommunicationEntitlements) {
  const baseEntitlements = await fs.readFile(
    path.join(__dirname, 'build', 'entitlements.mac.plist'),
    'utf8',
  );
  const communicationKeys = [
    '    <key>com.apple.application-identifier</key>',
    `    <string>${macTeamId}.${macAppId}</string>`,
    '    <key>com.apple.developer.team-identifier</key>',
    `    <string>${macTeamId}</string>`,
    '    <key>com.apple.developer.usernotifications.communication</key>',
    '    <true/>',
    '  </dict>',
  ].join('\n');
  await fs.writeFile(
    macCommunicationEntitlements,
    baseEntitlements.replace('</dict>', communicationKeys),
  );
  console.info('🔔 Communication notification entitlements + provisioning profile enabled');
}

// 自定义更新服务器 URL (用于 stable 频道)
const updateServerUrl = process.env.UPDATE_SERVER_URL;

console.info(`🚄 Build Version ${packageJSON.version}, Channel: ${channel}`);
console.info(`🏗️ Building for architecture: ${arch}`);

// Channel identity derived solely from UPDATE_CHANNEL env var.
// Supported channels: stable, nightly, canary
const isStable = !channel || channel === 'stable';
const isNightly = channel === 'nightly';
const isCanary = channel === 'canary';

// Strip trailing channel path from URL for re-appending the correct channel
// Handles both base URL (https://cdn.example.com) and legacy URL with channel (https://cdn.example.com/stable)
const stripChannelSuffix = (url) => url.replace(/\/(stable|nightly|canary|beta)\/?$/, '');

// 根据 channel 配置 publish provider
// - 所有渠道 + UPDATE_SERVER_URL: 使用 generic (S3)
// - 无 UPDATE_SERVER_URL: 回退到 GitHub (本地开发)
const getPublishConfig = () => {
  const channelPath = isStable ? 'stable' : isNightly ? 'nightly' : channel || 'stable';

  if (updateServerUrl) {
    const baseUrl = stripChannelSuffix(updateServerUrl);
    const fullUrl = `${baseUrl}/${channelPath}`;
    console.info(`📦 ${channelPath} channel: Using generic provider (${fullUrl})`);
    return [
      {
        provider: 'generic',
        url: fullUrl,
        // electron-builder names the emitted manifest `${publishConfig.channel}.yml`
        // (app-builder-lib/out/publish/updateInfoBuilder.js: `publishConfig.channel || "latest"`),
        // while electron-updater fetches `${autoUpdater.channel}.yml` — our shipped
        // client runs with channel `stable`, so it asks for stable.yml. Without this
        // the build ships a perfectly valid latest.yml that no client of ours ever
        // requests, and updates fail with ERR_UPDATER_CHANNEL_FILE_NOT_FOUND while
        // every artifact looks correct.
        //
        // It has to live on the provider: a top-level `channel` is rejected by the
        // schema ("configuration has an unknown property 'channel'").
        channel: channelPath,
      },
    ];
  }

  // A distribution with no update feed of its own must NOT inherit the GitHub
  // fallback below: the shipped app would poll github.com/lobehub/lobehub and
  // offer upstream releases as updates to a differently-branded build. That is
  // both a phone-home an air-gapped install cannot make and an upgrade path
  // straight off the distribution.
  if (process.env.DESKTOP_DISABLE_UPDATES === '1') {
    console.info(`📦 ${channelPath} channel: updates disabled (DESKTOP_DISABLE_UPDATES=1)`);
    return null;
  }

  // 本地开发无 S3 时回退到 GitHub
  console.info(`📦 ${channelPath} channel: No UPDATE_SERVER_URL, falling back to GitHub provider`);
  return [
    {
      owner: 'lobehub',
      provider: 'github',
      repo: 'lobehub',
    },
  ];
};

// https://www.electron.build/code-signing-mac#how-to-disable-code-signing-during-the-build-process-on-macos
if (!hasAppleCertificate) {
  // Disable auto discovery to keep electron-builder from searching unavailable signing identities
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  console.info('⚠️ Apple certificate link not found, macOS artifacts will be unsigned.');
}

/**
 * Distribution identity. A downstream build (private deployment, white-label)
 * has to be able to set these without forking this file.
 *
 * `appId` in particular is not cosmetic: Windows and macOS key the per-user
 * data directory off it, and the updater uses it to decide what an installed
 * app *is*. Changing it after a release orphans existing users' data, so a
 * distribution should pick one before shipping and never touch it again.
 */
const appId = process.env.DESKTOP_APP_ID || 'com.lobehub.lobehub-desktop';
const productName = process.env.DESKTOP_PRODUCT_NAME || 'LobeHub';
const executableName = process.env.DESKTOP_EXECUTABLE_NAME || 'LobeHub';

/**
 * Who the binary says it comes from — Windows' Properties -> Details, which is
 * the first place anyone looks to identify an executable.
 *
 * Read from env rather than left to `package.json`'s `author`, because a
 * distribution cannot edit that file: it belongs to this repository, and the
 * name in it is this project's. Left unset, everything below resolves to the
 * previous behaviour exactly.
 *
 * Applied HERE rather than through `--c.extraMetadata.author` on the command
 * line, which does not work and fails in a way that looks like it did:
 * `appInfo.companyName` reads `metadata.author?.name`, so the string form
 * replaces the normalised object, `.name` comes back undefined, and the exe
 * silently keeps Electron's own stock `CompanyName` — a worse answer than the
 * one being corrected. Verified on a real artifact, twice.
 */
const companyName = process.env.DESKTOP_COMPANY_NAME;

/**
 * Manifest fields a distribution overrides without editing `package.json`,
 * which belongs to this repository.
 *
 * They are collected into ONE `extraMetadata` object on purpose. Passing any of
 * them as `--c.extraMetadata.<field>` on the command line instead replaces this
 * whole object rather than merging into it, so a build that set the version
 * that way silently lost every other field — including `author`, whose absence
 * shows up three layers away as `CompanyName: GitHub, Inc.` on the exe.
 */
const extraMetadata = {
  ...(companyName ? { author: { name: companyName } } : {}),
  ...(process.env.DESKTOP_APP_DESCRIPTION
    ? { description: process.env.DESKTOP_APP_DESCRIPTION }
    : {}),
  ...(process.env.DESKTOP_HOMEPAGE_URL ? { homepage: process.env.DESKTOP_HOMEPAGE_URL } : {}),
  ...(process.env.DESKTOP_APP_VERSION ? { version: process.env.DESKTOP_APP_VERSION } : {}),
};

// 根据版本类型确定协议 scheme
const getProtocolScheme = () => {
  // A custom scheme has to be distinct per distribution too: schemes are
  // registered OS-wide, so two builds claiming `lobehub://` on one machine race
  // for the handler and the loser's deep links silently open the other app.
  if (process.env.DESKTOP_PROTOCOL_SCHEME) return process.env.DESKTOP_PROTOCOL_SCHEME;
  if (isCanary) return 'lobehub-canary';
  if (isNightly) return 'lobehub-nightly';
  return 'lobehub';
};

const protocolScheme = getProtocolScheme();

const sparklePublicKey = process.env.SPARKLE_ED_PUBLIC_KEY;
const { useSparkle } = resolveSparklePackaging({
  channel,
  hasAppleCertificate,
  platform: process.platform,
  sparklePublicKey,
  updateServerUrl,
  updatesDisabled: process.env.DESKTOP_DISABLE_UPDATES === '1',
});
const sparklePackageDir = useSparkle
  ? await fs.realpath(path.join(__dirname, 'node_modules/electron-sparkle-updater'))
  : null;
const sparkleFeedUrl =
  useSparkle && updateServerUrl
    ? `${stripChannelSuffix(updateServerUrl).replace(/\/$/, '')}/${isCanary || channel === 'beta' ? 'canary' : 'stable'}/appcast-${arch}.xml`
    : undefined;

// Determine icon file based on version type
const getIconFileName = () => {
  if (isStable || isCanary) return 'Icon';
  // nightly uses pre-release icon
  return 'Icon-nightly';
};

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration
 */
const config = {
  /**
   * BeforePack hook to resolve pnpm symlinks for native modules.
   * This ensures native modules are properly included in the asar archive.
   */
  beforePack: async (context) => {
    buildFirstPartyNativeAddons();

    if (sparklePackageDir) {
      console.info('🔧 Building Sparkle bridge addon...');
      execSync(
        `node "${path.join(sparklePackageDir, 'bin/electron-sparkle-updater.js')}" rebuild --arch ${arch}`,
        { cwd: __dirname, stdio: 'inherit' },
      );
    }

    await copyNativeModulesToSource();
    await copyExternalRuntimeModulesToSource();

    // agent-browser is no longer bundled in the installer — BinaryManager
    // lazily downloads it on first use into the per-user cache dir. See
    // apps/desktop/src/main/modules/binaries/agentBrowserBinaries.ts.

    // A distribution that builds the CLI with its own config (different bin
    // name, server, config directory) has to be able to embed THAT bundle —
    // otherwise the installer ships a CLI branded for a different product than
    // the app around it, with a different config directory, and the two
    // disagree about where credentials live.
    //
    // Point DESKTOP_EMBEDDED_CLI_BUNDLE at a prebuilt bundle to skip the
    // default build. Unset, this behaves exactly as before.
    const prebuiltCli = process.env.DESKTOP_EMBEDDED_CLI_BUNDLE
      ? path.resolve(process.env.DESKTOP_EMBEDDED_CLI_BUNDLE)
      : undefined;
    if (prebuiltCli) {
      console.info(`📦 Using prebuilt CLI bundle: ${prebuiltCli}`);
    } else {
      console.info('📦 Building CLI for embedding...');
      execSync('npm run build:cli', { stdio: 'inherit', cwd: __dirname });
    }

    // The shell window has no React/i18next runtime. Bundle only its translated strings.
    const updateStrings = {};
    for (const locale of ['en-US', 'zh-CN']) {
      const messages = JSON.parse(
        await fs.readFile(path.join(__dirname, '../../locales', locale, 'electron.json'), 'utf8'),
      );
      updateStrings[locale] = Object.fromEntries(
        Object.entries(messages)
          .filter(([key]) => key.startsWith('startupUpdate.'))
          .map(([key, value]) => [
            key.slice('startupUpdate.'.length),
            // The shell window has no React/i18next runtime, so the brand
            // post-processor that rewrites locale strings never sees these:
            // substitute the product name here. It defaults to the upstream
            // name, so an unbranded build ships the strings unchanged.
            typeof value === 'string' ? value.replaceAll('LobeHub', productName) : value,
          ]),
      );
    }
    await fs.writeFile(
      path.join(__dirname, 'shell/update/strings.json'),
      JSON.stringify(updateStrings, null, 2) + '\n',
    );

    execSync('node scripts/shellAbi.mjs --write', { stdio: 'inherit', cwd: __dirname });
    const { shellAbi } = JSON.parse(
      await fs.readFile(path.join(__dirname, 'shell/abi.json'), 'utf8'),
    );
    const corePlatform =
      context.electronPlatformName === 'mas' ? 'darwin' : context.electronPlatformName;
    execSync('node scripts/assembleCore.mjs', {
      cwd: __dirname,
      env: {
        ...process.env,
        ...(prebuiltCli ? { DESKTOP_EMBEDDED_CLI_BUNDLE: prebuiltCli } : {}),
      },
      stdio: 'inherit',
    });
    execSync(
      `node scripts/buildCoreManifest.mjs --core=core-dist --platform=${corePlatform} --channel=${channel || 'stable'} --version=${packageJSON.version} --seq=${process.env.CORE_SEQ || 0} --shell-abi=${shellAbi}`,
      { stdio: 'inherit', cwd: __dirname },
    );
    await packBuiltinCore(__dirname);
  },
  /**
   * AfterPack hook for copying Liquid Glass Assets.car on macOS 26+.
   *
   * @see https://github.com/electron-userland/electron-builder/issues/9254
   * @see https://github.com/MultiboxLabs/flow-browser/pull/159
   */
  afterPack: async (context) => {
    const isMac = ['darwin', 'mas'].includes(context.electronPlatformName);

    if (!isMac) {
      return;
    }

    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    const resourcesPath = path.join(appPath, 'Contents', 'Resources');

    const iconFileName = getIconFileName();
    const assetsCarSource = path.join(__dirname, 'build', `${iconFileName}.Assets.car`);
    const assetsCarDest = path.join(resourcesPath, 'Assets.car');

    try {
      await fs.access(assetsCarSource);
      await fs.copyFile(assetsCarSource, assetsCarDest);
      console.info(`✅ Copied Liquid Glass icon: ${iconFileName}.Assets.car`);
    } catch {
      // Non-critical: Assets.car not found or copy failed
      // App will use fallback .icns icon on all macOS versions
      console.info(`⏭️  Skipping Assets.car (not found or copy failed)`);
    }
  },
  afterSign: async (context) => {
    await verifyFontListSignature(context);

    if (context.electronPlatformName === 'darwin' && hasAppleCertificate) {
      await notarizeMacApp(
        path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
      );
    }
  },
  appId,
  // Both derive from the same name, and `copyright` has to be explicit: left
  // unset, electron-builder falls back to `companyName || productName`, which
  // would put the product name where a legal entity belongs.
  ...(companyName ? { copyright: `Copyright © ${new Date().getFullYear()} ${companyName}` } : {}),
  ...(Object.keys(extraMetadata).length > 0 ? { extraMetadata } : {}),
  appImage: {
    artifactName: '${productName}-${version}.${ext}',
  },

  // Only explicitly selected native binaries should live outside app.asar.
  asar: {
    smartUnpack: false,
  },

  // Native modules must be unpacked from asar to work correctly
  asarUnpack: getAsarUnpackPatterns(),

  ...(useSparkle ? { buildVersion: toSparkleBuildVersion(packageJSON.version) } : {}),

  detectUpdateChannel: true,

  directories: {
    buildResources: 'build',
    output: 'release',
  },

  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
    background: 'resources/dmg.png',
    contents: [
      { type: 'file', x: 150, y: 240 },
      { type: 'link', path: '/Applications', x: 450, y: 240 },
    ],
    iconSize: 80,
    window: {
      height: 400,
      width: 600,
    },
  },

  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/',
  },
  // Electron uses underscores for macOS .lproj directories and hyphens for
  // Windows/Linux locale packs. Keep the English variants on every platform.
  electronLanguages: ['en', 'en_GB', 'en_US', 'en-GB', 'en-US'],

  files: [
    'shell/**',
    '!shell/__tests__',
    ...(useSparkle ? ['!shell/rescue/electron-updater.cjs'] : []),
    'package.json',
    // Exclude all node_modules first
    '!node_modules',
    // Then explicitly include native modules using object form (handles pnpm symlinks)
    ...getNativeModulesFilesConfig(),
    // electron-log ships in the core (assembleCore), a shell copy would shadow it via the resolver shim
    ...getModuleFilesConfig(['font-list']),
  ],
  generateUpdatesFilesForAllChannels: true,
  linux: {
    category: 'Utility',
    icon: 'build/icon.png',
    maintainer: 'electronjs.org',
    target: ['AppImage', 'snap', 'deb', 'rpm', 'tar.gz'],
  },
  mac: {
    binaries: ['Contents/Resources/app.asar.unpacked/node_modules/font-list/libs/darwin/fontlist'],
    compression: 'maximum',
    entitlementsInherit: 'build/entitlements.mac.plist',
    ...(macCommunicationEntitlements
      ? {
          entitlements: macCommunicationEntitlements,
          provisioningProfile: macProvisioningProfile,
        }
      : {}),
    extendInfo: {
      ...(useSparkle
        ? {
            SUDeltaChainHistory: 6,
            SUEnableAutomaticChecks: false,
            SUEnableInstallerLauncherService: false,
            SUFeedURL: sparkleFeedUrl,
            SUPublicEDKey: sparklePublicKey,
          }
        : {}),
      CFBundleIconName: 'AppIcon',
      CFBundleURLTypes: [
        {
          CFBundleURLName: `${productName} Protocol`,
          CFBundleURLSchemes: [protocolScheme],
        },
      ],
      NSAppleEventsUsageDescription:
        'Application needs to control System Settings to help you grant Full Disk Access automatically.',
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
      NSLocalNetworkUsageDescription:
        'Application connects to self-hosted servers, model providers, and other services on your local network.',
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSScreenCaptureUsageDescription:
        'Application requests access to record and analyze screen content for AI assistance.',
      NSUserActivityTypes: ['INSendMessageIntent'],
    },
    gatekeeperAssess: false,
    hardenedRuntime: hasAppleCertificate,
    // Notarized in afterSign so a transient staple failure retries instead of failing the build.
    notarize: false,
    ...(hasAppleCertificate ? {} : { identity: null }),
    target: [
      { arch: [arch === 'arm64' ? 'arm64' : 'x64'], target: 'dmg' },
      { arch: [arch === 'arm64' ? 'arm64' : 'x64'], target: 'zip' },
    ],
  },
  npmRebuild: true,
  nsis: {
    allowToChangeInstallationDirectory: true,
    artifactName: '${productName}-${version}-setup.${ext}',
    createDesktopShortcut: 'always',
    installerHeader: './build/nsis-header.bmp',
    installerSidebar: './build/nsis-sidebar.bmp',
    oneClick: false,
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    uninstallerSidebar: './build/nsis-sidebar.bmp',
  },
  // Drives ${productName} in every artifactName/shortcutName template above, and
  // is the name the installer and the OS show the user.
  productName,
  protocols: [
    {
      name: `${productName} Protocol`,
      schemes: [protocolScheme],
    },
  ],
  publish: getPublishConfig(),

  // Release notes 配置
  // 可以通过环境变量 RELEASE_NOTES 传入，或从文件读取
  // 这会被写入 latest-mac.yml / latest.yml 中，供 generic provider 使用
  releaseInfo: {
    releaseNotes: process.env.RELEASE_NOTES || undefined,
  },

  ...(sparklePackageDir
    ? {
        extraFiles: [
          {
            from: path.join(sparklePackageDir, 'native/vendor/Sparkle.framework'),
            to: 'Frameworks/Sparkle.framework',
          },
        ],
      }
    : {}),
  extraResources: [
    { from: 'core.asar', to: 'core.asar' },
    { from: 'core.asar.unpacked', to: 'core.asar.unpacked' },
    // The Sparkle bridge addon is loaded by an explicit path outside app.asar; pnpm's
    // symlinked package dir cannot be matched by asarUnpack, so it ships as a resource.
    ...(sparklePackageDir
      ? [
          {
            from: path.join(sparklePackageDir, 'native/build/Release/sparkle_bridge.node'),
            to: 'sparkle/sparkle_bridge.node',
          },
        ]
      : []),
    // Local Sandbox helper binaries. The sandbox spawns these by path, so they
    // must be real files — not entries inside app.asar, and not something the
    // user is expected to install separately.
    //
    // Shipped as a resource rather than by externalizing
    // `@anthropic-ai/sandbox-runtime`: its JavaScript bundles into the main
    // process perfectly well, and making it a production dependency instead
    // drags four transitive packages into electron-builder's node_modules
    // traversal, which pnpm's layout does not satisfy (`@pondwader/socks5-server
    // not found`). Only the binaries need to exist on disk.
    {
      from: 'node_modules/@anthropic-ai/sandbox-runtime/vendor',
      to: 'sandbox-runtime/vendor',
    },
    // Carried alongside the binaries so the staging directory stays keyed on the
    // backend's real version. Without it the version lookup falls back to the
    // binary's size — which still works, but would defeat the per-version
    // isolation in exactly the case it exists for: an installed app being
    // updated.
    {
      from: 'node_modules/@anthropic-ai/sandbox-runtime/package.json',
      to: 'sandbox-runtime/package.json',
    },
    {
      from: 'node_modules/@anthropic-ai/sandbox-runtime/LICENSE',
      to: 'sandbox-runtime/LICENSE',
    },
  ],

  win: {
    executableName,
  },
};

export default config;
