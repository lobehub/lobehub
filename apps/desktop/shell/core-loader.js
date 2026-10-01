const { verify } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const MAX_BOOT_FAILURES = 3;
const VERSION_NAME = /^[\w.+-]{1,64}$/;
const UNSAFE_SEGMENT = /^\.\.?$/;
const MAIN_ENTRY = 'dist/main/index.js';
const RENDERER_PREFIX = 'dist/renderer/';

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

const verifyManifestSignature = (manifest, publicKeyPem) => {
  const { signature, ...unsigned } = manifest;
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(unsigned)),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

const writeJson = (file, value) => {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
};

const verifyCandidate = (dir, { abi, builtinHashes, publicKey, storeDir }) => {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest) throw new Error('manifest missing or unreadable');
  if (!verifyManifestSignature(manifest, publicKey)) throw new Error('bad signature');
  if (manifest.shellAbi !== abi) throw new Error(`shellAbi ${manifest.shellAbi} != ${abi}`);
  for (const entry of manifest.tree) {
    if (
      typeof entry.path !== 'string' ||
      path.isAbsolute(entry.path) ||
      entry.path.includes('\\') ||
      entry.path.split('/').some((segment) => UNSAFE_SEGMENT.test(segment))
    )
      throw new Error(`unsafe tree path ${JSON.stringify(entry.path)}`);
  }
  if (!manifest.tree.some((entry) => entry.path === MAIN_ENTRY))
    throw new Error(`${MAIN_ENTRY} not in tree`);
  // Content hashes are verified once while staging; hashing ~110 MB here cost ~600 ms on a
  // cold Windows boot. Sizes still catch truncated, deleted or quarantined files.
  for (const file of manifest.tree) {
    const overlaid = file.path.startsWith(RENDERER_PREFIX);
    // Renderer content is never materialized: the core serves it by hash from the builtin
    // archive or the OTA object store.
    if (overlaid && builtinHashes.has(file.sha256)) continue;
    const source = overlaid ? path.join(storeDir, file.sha256) : path.join(dir, file.path);
    const stat = fs.statSync(source, { throwIfNoEntry: false });
    if (!stat) throw new Error(`missing ${file.path}`);
    if (stat.size !== file.size) throw new Error(`size mismatch ${file.path}`);
  }
  return manifest;
};

function resolveCore({ userData, builtinDir, abi, publicKey }) {
  const otaRoot = path.join(userData, 'core-ota');
  const bootFile = path.join(otaRoot, 'boot.json');
  const pointerFile = path.join(otaRoot, 'pointer.json');
  const stored = readJson(pointerFile);
  const pointer = stored?.abi === abi ? stored : {};
  const boot = readJson(bootFile) ?? {};
  const blacklist = Array.isArray(pointer.blacklist) ? pointer.blacklist : [];
  const log = [];
  if (stored && stored !== pointer) log.push(`pointer abi ${stored.abi} != ${abi}, ignored`);

  const savePointer = (patch) => {
    Object.assign(pointer, patch);
    try {
      writeJson(pointerFile, {
        abi,
        blacklist,
        channel: pointer.channel ?? null,
        current: pointer.current ?? null,
        previous: pointer.previous ?? null,
        staged: pointer.staged ?? null,
      });
    } catch (error) {
      log.push(`pointer write failed: ${error.message}`);
    }
  };

  const builtinManifest = readJson(path.join(builtinDir, 'manifest.json')) ?? null;
  const builtinSeq = typeof builtinManifest?.seq === 'number' ? builtinManifest.seq : null;
  const builtinHashes = new Set(
    Array.isArray(builtinManifest?.tree) ? builtinManifest.tree.map((file) => file.sha256) : [],
  );
  const storeDir = path.join(otaRoot, 'store');
  const channel = typeof pointer.channel === 'string' ? pointer.channel : builtinManifest?.channel;
  // seq counters are per channel: a full release ships a builtin core with a seq above every
  // published core of its own channel, so older external cores of that channel must not outlive it.
  const rejectReason = (manifest) => {
    if (channel && manifest.channel && manifest.channel !== channel)
      return `channel ${manifest.channel} != ${channel}`;
    if (
      builtinSeq !== null &&
      manifest.channel === builtinManifest.channel &&
      typeof manifest.seq === 'number' &&
      manifest.seq <= builtinSeq
    )
      return `seq ${manifest.seq} superseded by builtin seq ${builtinSeq}`;
    return null;
  };

  const bootMarkers = (version) => {
    const mark = (label, value) => () => {
      try {
        writeJson(bootFile, { ...value, version });
      } catch (error) {
        log.push(`${label} failed: ${error.message}`);
      }
    };
    return {
      markBroken: mark('markBroken', { failures: MAX_BOOT_FAILURES, healthy: false }),
      markHealthy: mark('markHealthy', { failures: 0, healthy: true }),
    };
  };

  const verified = new Map();
  const loadCandidate = (version) => {
    if (typeof version !== 'string' || !VERSION_NAME.test(version) || UNSAFE_SEGMENT.test(version))
      throw new Error(`invalid core version name ${JSON.stringify(version)}`);
    if (blacklist.includes(version)) throw new Error('blacklisted');
    const dir = path.join(otaRoot, 'cores', version);
    if (!verified.has(version))
      verified.set(version, verifyCandidate(dir, { abi, builtinHashes, publicKey, storeDir }));
    return { dir, manifest: verified.get(version) };
  };
  const verifies = (version) => {
    try {
      return Boolean(loadCandidate(version));
    } catch {
      return false;
    }
  };

  if (pointer.staged) {
    try {
      const { manifest } = loadCandidate(pointer.staged);
      const reason = rejectReason(manifest);
      if (reason) {
        log.push(`staged ${pointer.staged} ${reason}`);
        savePointer({ staged: null });
      } else {
        savePointer({ current: pointer.staged, previous: pointer.current ?? null, staged: null });
      }
    } catch (error) {
      log.push(`staged ${pointer.staged} rejected: ${error.message}`);
    }
  }

  const candidates = [pointer.current, pointer.previous];
  for (const [index, version] of candidates.entries()) {
    if (!version) continue;
    const failures = boot.version === version ? Number(boot.failures) || 0 : 0;
    if (failures >= MAX_BOOT_FAILURES) {
      log.push(`core ${version} blacklisted after ${failures} boot failures`);
      if (!blacklist.includes(version)) blacklist.push(version);
      const next = candidates[index + 1];
      savePointer({ current: verifies(next) ? next : null, previous: null });
      continue;
    }
    try {
      const { dir, manifest } = loadCandidate(version);
      const reason = rejectReason(manifest);
      if (reason) {
        log.push(`core ${version} ${reason}`);
        savePointer({ current: null, previous: null });
        break;
      }
      const healthy = boot.version === version && boot.healthy === true;
      writeJson(bootFile, { failures: failures + 1, healthy, version });
      return { dir, log, manifest, ...bootMarkers(version), source: 'external' };
    } catch (error) {
      log.push(`core ${version} rejected: ${error.message}`);
    }
  }

  if (!builtinManifest) log.push(`builtin manifest missing at ${builtinDir}`);
  const builtinKey = `builtin@${builtinManifest?.version ?? 'unknown'}`;
  const builtinFailures = boot.version === builtinKey ? Number(boot.failures) || 0 : 0;
  if (builtinFailures >= MAX_BOOT_FAILURES) {
    log.push(`${builtinKey} failed ${builtinFailures} boots`);
    return { dir: builtinDir, log, manifest: builtinManifest, source: 'rescue' };
  }
  try {
    fs.mkdirSync(otaRoot, { recursive: true });
    writeJson(bootFile, {
      failures: builtinFailures + 1,
      healthy: boot.version === builtinKey && boot.healthy === true,
      version: builtinKey,
    });
  } catch (error) {
    log.push(`builtin boot count failed: ${error.message}`);
  }
  return {
    dir: builtinDir,
    log,
    manifest: builtinManifest,
    ...bootMarkers(builtinKey),
    source: 'builtin',
  };
}

const packageName = (request) =>
  request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0];

function installShellResolver(shellNodeModules) {
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    const bare = !/^(?:\.|node:)/.test(request) && !path.isAbsolute(request);
    if (bare && fs.existsSync(path.join(shellNodeModules, packageName(request))))
      return original.call(this, request, parent, isMain, {
        ...options,
        paths: [shellNodeModules],
      });
    return original.apply(this, arguments);
  };
  return () => {
    Module._resolveFilename = original;
  };
}

module.exports = {
  canonicalJson,
  installShellResolver,
  resolveCore,
  verifyManifestSignature,
};
