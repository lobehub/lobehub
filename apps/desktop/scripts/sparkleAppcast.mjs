import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

export const ARCHES = ['arm64', 'x64'];

export const ownZipName = (fileNames, version, arch) => {
  const suffix = arch === 'arm64' ? `-${version}-arm64-mac.zip` : `-${version}-mac.zip`;
  const matches = fileNames.filter((name) => name.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${arch} zip for ${version}, found ${matches.length}`);
  }
  return matches[0];
};

export const previousArchives = (appcastXml, count) => {
  const items = [];
  for (const [, item] of appcastXml.matchAll(/<item>([\S\s]*?)<\/item>/g)) {
    const url = item.match(/<enclosure[^>]*\surl="([^"]+)"/)?.[1];
    const version =
      item.match(/<sparkle:version>([^<]+)<\/sparkle:version>/)?.[1] ??
      item.match(/<enclosure[^>]*\ssparkle:version="([^"]+)"/)?.[1];
    if (url && version) items.push({ url, version });
  }
  return items.slice(0, count);
};

export const s3KeyFromUrl = (url, serverUrl) => {
  const base = serverUrl.replace(/\/$/, '');
  if (!url.startsWith(`${base}/`)) throw new Error(`enclosure ${url} is outside ${serverUrl}`);
  return url.slice(base.length + 1);
};

const run = (command, args, options = {}) => {
  console.info(`$ ${command} ${args.join(' ')}`);
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
};

const createS3 = ({ bucket, endpoint }) => {
  const endpointArgs = endpoint ? ['--endpoint-url', endpoint] : [];
  const aws = (args) => run('aws', ['s3', ...args, ...endpointArgs]);
  return {
    download: (key, dest) => {
      try {
        aws(['cp', `s3://${bucket}/${key}`, dest]);
        return true;
      } catch {
        return false;
      }
    },
    upload: (src, key, cacheControl) =>
      aws(['cp', src, `s3://${bucket}/${key}`, '--cache-control', cacheControl]),
  };
};

export const publishArch = (arch, options) => {
  const {
    channel,
    deltaBases,
    deltaHistory,
    historyScript,
    keyFile,
    out,
    releaseDir,
    releaseNotes,
    s3,
    serverUrl,
    sparkleBin,
    version,
  } = options;
  const dir = path.join(out, arch);
  const historyDir = path.join(dir, 'history');
  mkdirSync(path.join(historyDir, '00'), { recursive: true });

  const zipName = ownZipName(readdirSync(releaseDir), version, arch);
  copyFileSync(path.join(releaseDir, zipName), path.join(dir, zipName));
  if (releaseNotes) writeFileSync(path.join(dir, zipName.replace(/\.zip$/, '.md')), releaseNotes);

  const feedKey = `${channel}/appcast-${arch}.xml`;
  const previousFeed = path.join(historyDir, '00', 'appcast.xml');
  if (s3.download(feedKey, previousFeed)) {
    for (const archive of previousArchives(readFileSync(previousFeed, 'utf8'), deltaBases)) {
      const key = s3KeyFromUrl(archive.url, serverUrl);
      if (!s3.download(key, path.join(dir, path.basename(key)))) {
        console.warn(`delta base ${archive.version} missing at ${key}; skipping`);
      }
    }
  } else {
    console.info(`no previous ${feedKey}; publishing a first appcast without deltas`);
  }

  const buildVersion = run('python3', [historyScript, 'version', path.join(dir, zipName)]).trim();
  const appcast = path.join(dir, 'appcast.xml');
  run(
    path.join(sparkleBin, 'generate_appcast'),
    [
      '--versions',
      buildVersion,
      '--maximum-versions',
      '1',
      '--maximum-deltas',
      String(deltaBases),
      '--ed-key-file',
      keyFile,
      '--download-url-prefix',
      `${serverUrl}/${channel}/${version}/`,
      '--embed-release-notes',
      '-o',
      appcast,
      dir,
    ],
    { stdio: 'inherit' },
  );
  run(
    'python3',
    [
      historyScript,
      'merge',
      appcast,
      '--history-dir',
      historyDir,
      '--history',
      String(deltaHistory),
    ],
    { stdio: 'inherit' },
  );
  run(path.join(sparkleBin, 'sign_update'), ['--ed-key-file', keyFile, appcast], {
    stdio: 'inherit',
  });

  for (const name of readdirSync(dir).filter((f) => f.endsWith('.delta'))) {
    s3.upload(
      path.join(dir, name),
      `${channel}/${version}/${name}`,
      'public,max-age=31536000,immutable',
    );
  }
  s3.upload(appcast, `${channel}/${version}/appcast-${arch}.xml`, 'no-store');
  s3.upload(appcast, feedKey, 'no-store');
  console.info(`published ${feedKey} for ${version}`);
};

const main = () => {
  const { values } = parseArgs({
    options: {
      'arches': { default: ARCHES.join(','), type: 'string' },
      'bucket': { type: 'string' },
      'channel': { type: 'string' },
      'delta-bases': { default: '1', type: 'string' },
      'delta-history': { default: '6', type: 'string' },
      'endpoint': { default: '', type: 'string' },
      'history-script': { type: 'string' },
      'key-file': { type: 'string' },
      'out': { type: 'string' },
      'release-dir': { type: 'string' },
      'server-url': { type: 'string' },
      'sparkle-bin': { type: 'string' },
      'version': { type: 'string' },
    },
  });
  for (const key of [
    'bucket',
    'channel',
    'history-script',
    'key-file',
    'out',
    'release-dir',
    'server-url',
    'sparkle-bin',
    'version',
  ]) {
    if (!values[key]) throw new Error(`--${key} is required`);
  }
  if (!existsSync(values['key-file'])) throw new Error('EdDSA key file not found');

  const serverUrl = values['server-url'].replace(/\/(stable|nightly|canary|beta)?\/?$/, '');
  const options = {
    channel: values.channel,
    deltaBases: Number(values['delta-bases']),
    deltaHistory: Number(values['delta-history']),
    historyScript: values['history-script'],
    keyFile: values['key-file'],
    out: values.out,
    releaseDir: values['release-dir'],
    releaseNotes: process.env.RELEASE_NOTES,
    s3: createS3({ bucket: values.bucket, endpoint: values.endpoint }),
    serverUrl,
    sparkleBin: values['sparkle-bin'],
    version: values.version,
  };
  for (const arch of values.arches.split(',')) publishArch(arch, options);
};

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main();
}
