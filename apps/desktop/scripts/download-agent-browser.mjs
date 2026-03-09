import fs, { createWriteStream } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const VERSION = '0.17.0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, '..', 'resources', 'bin');
const versionFile = path.join(binDir, '.agent-browser-version');

const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'win32' };
const archMap = { arm64: 'arm64', x64: 'x64' };

const platform = platformMap[process.platform];
const arch = archMap[process.arch];

if (!platform || !arch) {
  console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const binaryName = `agent-browser-${platform}-${arch}${isWindows ? '.exe' : ''}`;
const outputName = `agent-browser${isWindows ? '.exe' : ''}`;
const outputPath = path.join(binDir, outputName);

// Check if already downloaded
if (fs.existsSync(versionFile)) {
  const existing = fs.readFileSync(versionFile, 'utf8').trim();
  if (existing === VERSION && fs.existsSync(outputPath)) {
    console.log(`agent-browser v${VERSION} already downloaded, skipping.`);
    process.exit(0);
  }
}

const url = `https://github.com/vercel-labs/agent-browser/releases/download/v${VERSION}/${binaryName}`;

console.log(`Downloading agent-browser v${VERSION} for ${platform}-${arch}...`);
console.log(`URL: ${url}`);

await mkdir(binDir, { recursive: true });

/**
 * Follow redirects and download to a writable stream.
 */
function download(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    https
      .get(url, { headers: { 'User-Agent': 'lobehub-desktop' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return download(res.headers.location, dest, maxRedirects - 1).then(resolve, reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }

        const file = createWriteStream(dest);
        pipeline(res, file).then(resolve, reject);
      })
      .on('error', reject);
  });
}

try {
  await download(url, outputPath);

  if (!isWindows) {
    await chmod(outputPath, 0o755);
  }

  await writeFile(versionFile, VERSION, 'utf8');
  console.log(`Successfully downloaded agent-browser v${VERSION} to ${outputPath}`);
} catch (err) {
  console.error(`Failed to download agent-browser: ${err.message}`);
  process.exit(1);
}
