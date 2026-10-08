import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson, resolveCore } from '../core-loader.js';

const ABI = 'a'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const unsignedOf = (manifest) =>
  Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'signature'));

const signManifest = (manifest) => ({
  ...manifest,
  signature: sign(null, Buffer.from(canonicalJson(manifest)), privateKeyPem).toString('base64'),
});

let tmp;
let userData;
let builtinDir;
const otaRoot = () => path.join(userData, 'core-ota');
const pointerFile = () => path.join(otaRoot(), 'pointer.json');
const readBoot = () => JSON.parse(fs.readFileSync(path.join(otaRoot(), 'boot.json'), 'utf8'));
const readPointer = () => JSON.parse(fs.readFileSync(pointerFile(), 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

const writeCore = (dir, version, { shellAbi = ABI, seq, channel, schemaVersion, mutate } = {}) => {
  const files = {
    'cli/lobe-cli.js': 'cli',
    'dist/main/index.js': `module.exports = ${JSON.stringify(version)};`,
    'dist/preload/index.js': '// preload',
    'dist/renderer/index.html': '<html/>',
    'node_modules/electron-log/main.js': 'log',
    'package.json': '{"type":"commonjs"}',
  };
  const tree = Object.entries(files).map(([filePath, content]) => {
    fs.mkdirSync(path.join(dir, path.dirname(filePath)), { recursive: true });
    fs.writeFileSync(path.join(dir, filePath), content);
    return { path: filePath, sha256: sha256(content), size: content.length };
  });
  const manifest = signManifest({
    shellAbi,
    tree,
    version,
    ...(seq === undefined ? {} : { seq }),
    ...(schemaVersion === undefined ? {} : { schemaVersion }),
    ...(channel === undefined ? {} : { channel }),
  });
  mutate?.(dir, manifest);
  writeJson(path.join(dir, 'manifest.json'), manifest);
};

const writePointer = (pointer) => writeJson(pointerFile(), { abi: ABI, ...pointer });

const writeExternal = (version, opts) =>
  writeCore(path.join(otaRoot(), 'cores', version), version, opts);

const resolve = () =>
  resolveCore({ abi: ABI, builtinDir, platform: 'linux', publicKey: publicKeyPem, userData });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-loader-'));
  userData = path.join(tmp, 'userData');
  builtinDir = path.join(tmp, 'builtin');
  writeCore(builtinDir, '1.0.0');
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { force: true, recursive: true });
});

describe('resolveCore', () => {
  it('drops an older shell namespace after a full update even when its OTA seq is higher', () => {
    writeCore(builtinDir, '1.0.2-canary.1', { channel: 'canary', seq: 0, schemaVersion: 4 });
    writeExternal('1.0.1-canary.1-101', { channel: 'canary', seq: 101, schemaVersion: 4 });
    writePointer({ channel: 'canary', current: '1.0.1-canary.1-101' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join(' ')).toContain('does not belong to 1.0.2-canary.1');
  });

  it('loads a v4 core named <shellVersion>-<seq>', () => {
    writeCore(builtinDir, '1.0.2-canary.1', { channel: 'canary', seq: 0, schemaVersion: 4 });
    writeExternal('1.0.2-canary.1-3', { channel: 'canary', seq: 3, schemaVersion: 4 });
    writePointer({ channel: 'canary', current: '1.0.2-canary.1-3' });
    expect(resolve().manifest.version).toBe('1.0.2-canary.1-3');
  });

  it('rejects a v4 core whose suffix is not a numeric seq', () => {
    writeCore(builtinDir, '1.0.2', { channel: 'stable', seq: 0, schemaVersion: 4 });
    writeExternal('1.0.2-canary.1', { channel: 'stable', seq: 9, schemaVersion: 4 });
    writePointer({ channel: 'stable', current: '1.0.2-canary.1' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join(' ')).toContain('does not belong to 1.0.2');
  });

  it('ignores staged and current OTA cores on macOS Stable even with a Canary pointer', () => {
    writeCore(builtinDir, '1.0.0', { channel: 'stable', seq: 0 });
    writeExternal('1.0.1-1', { channel: 'canary', seq: 1 });
    writePointer({ channel: 'canary', current: '1.0.1-1', staged: '1.0.1-1' });
    writeJson(path.join(userData, 'lobehub-settings.json'), { updateChannel: 'stable' });
    const core = resolveCore({
      abi: ABI,
      builtinDir,
      platform: 'darwin',
      publicKey: publicKeyPem,
      userData,
    });
    expect(core.source).toBe('builtin');
    expect(readPointer()).toMatchObject({ channel: 'stable', current: null, staged: null });
  });

  it('loads OTA when a macOS Stable build has opted into Canary', () => {
    writeCore(builtinDir, '1.0.0', { channel: 'stable', seq: 0 });
    writeExternal('1.0.1-1', { channel: 'canary', seq: 1 });
    writePointer({ channel: 'canary', current: '1.0.1-1' });
    writeJson(path.join(userData, 'lobehub-settings.json'), { updateChannel: 'canary' });
    const core = resolveCore({
      abi: ABI,
      builtinDir,
      platform: 'darwin',
      publicKey: publicKeyPem,
      userData,
    });
    expect(core.source).toBe('external');
  });

  it('falls back to builtin when there is no pointer', () => {
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.dir).toBe(builtinDir);
    expect(core.manifest.version).toBe('1.0.0');
  });

  it('returns builtin with null manifest when builtin manifest is missing', () => {
    fs.rmSync(path.join(builtinDir, 'manifest.json'));
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.manifest).toBeNull();
    expect(core.log.join('\n')).toMatch(/builtin/);
  });

  it('loads a valid current core and bumps boot failures', () => {
    writeExternal('1.1.0');
    writePointer({ current: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('external');
    expect(core.dir).toBe(path.join(otaRoot(), 'cores', '1.1.0'));
    expect(core.manifest.version).toBe('1.1.0');
    expect(readBoot()).toEqual({ failures: 1, healthy: false, version: '1.1.0' });
  });

  it('rejects a core whose shellAbi differs', () => {
    writeExternal('1.1.0', { shellAbi: 'b'.repeat(64) });
    writePointer({ current: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toMatch(/shellAbi/);
  });

  it('rejects a core with a bad signature', () => {
    writeExternal('1.1.0', { mutate: (_, manifest) => (manifest.version = '9.9.9') });
    writePointer({ current: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toMatch(/signature/);
  });

  it('rejects a core whose main file size mismatches', () => {
    writeExternal('1.1.0', {
      mutate: (dir) => fs.writeFileSync(path.join(dir, 'dist/main/index.js'), 'tampered'),
    });
    writePointer({ current: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toContain('size mismatch dist/main/index.js');
  });

  it.each(['node_modules/electron-log/main.js', 'cli/lobe-cli.js', 'package.json'])(
    'rejects a core whose %s size mismatches',
    (file) => {
      writeExternal('1.1.0', {
        mutate: (dir) => fs.writeFileSync(path.join(dir, file), 'tampered content'),
      });
      writePointer({ current: '1.1.0' });
      const core = resolve();
      expect(core.source).toBe('builtin');
      expect(core.log.join('\n')).toContain(`size mismatch ${file}`);
    },
  );

  it('rejects a core with a missing tree file', () => {
    writeExternal('1.1.0', {
      mutate: (dir) => fs.rmSync(path.join(dir, 'cli/lobe-cli.js')),
    });
    writePointer({ current: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toContain('missing cli/lobe-cli.js');
  });

  it('accepts same-size local edits because content is hashed only while staging', () => {
    writeExternal('1.1.0', {
      mutate: (dir) => fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjz"}'),
    });
    writePointer({ current: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('external');
    expect(core.manifest.version).toBe('1.1.0');
  });

  describe('renderer overlay', () => {
    const storeObject = (content) => {
      const file = path.join(otaRoot(), 'store', sha256(content));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return file;
    };
    const overlayExternal = (renderer) =>
      writeExternal('1.1.0', {
        mutate: (dir, manifest) => {
          fs.rmSync(path.join(dir, 'dist/renderer'), { force: true, recursive: true });
          if (renderer === undefined) return;
          const entry = manifest.tree.find((file) => file.path === 'dist/renderer/index.html');
          Object.assign(entry, { sha256: sha256(renderer), size: renderer.length });
          Object.assign(manifest, signManifest(unsignedOf(manifest)));
        },
      });

    it('accepts renderer content served from the builtin core', () => {
      overlayExternal();
      writePointer({ current: '1.1.0' });
      const core = resolve();
      expect(core.source).toBe('external');
      expect(core.manifest.version).toBe('1.1.0');
    });

    it('accepts changed renderer content served from the object store', () => {
      overlayExternal('<html>new</html>');
      storeObject('<html>new</html>');
      writePointer({ current: '1.1.0' });
      expect(resolve().source).toBe('external');
    });

    it('rejects changed renderer content missing from the object store', () => {
      overlayExternal('<html>new</html>');
      writePointer({ current: '1.1.0' });
      const core = resolve();
      expect(core.source).toBe('builtin');
      expect(core.log.join('\n')).toContain('missing dist/renderer/index.html');
    });

    it('rejects a truncated object in the store', () => {
      overlayExternal('<html>new</html>');
      fs.truncateSync(storeObject('<html>new</html>'), 3);
      writePointer({ current: '1.1.0' });
      const core = resolve();
      expect(core.source).toBe('builtin');
      expect(core.log.join('\n')).toContain('size mismatch dist/renderer/index.html');
    });
  });

  it.each(['../x', 'dist/main/../x', './x', '/x', 'dist\\main\\x'])(
    'rejects a signed manifest whose tree contains %s',
    (unsafe) => {
      writeExternal('1.1.0', {
        mutate: (_, manifest) => {
          delete manifest.signature;
          manifest.tree.push({ path: unsafe, sha256: sha256(''), size: 0 });
          Object.assign(manifest, signManifest(manifest));
        },
      });
      writePointer({ current: '1.1.0' });
      const core = resolve();
      expect(core.source).toBe('builtin');
      expect(core.log.join('\n')).toMatch(/unsafe tree path/);
    },
  );

  it('falls back to previous after 3 boot failures of current', () => {
    writeExternal('1.1.0');
    writeExternal('1.0.5');
    writePointer({ current: '1.1.0', previous: '1.0.5' });
    writeJson(path.join(otaRoot(), 'boot.json'), { failures: 3, version: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('external');
    expect(core.manifest.version).toBe('1.0.5');
    expect(readBoot()).toEqual({ failures: 1, healthy: false, version: '1.0.5' });
    expect(readPointer()).toEqual({
      abi: ABI,
      blacklist: ['1.1.0'],
      channel: null,
      current: '1.0.5',
      previous: null,
      staged: null,
    });
  });

  it('nulls current after 3 boot failures when previous is unverifiable', () => {
    writeExternal('1.1.0');
    writePointer({ current: '1.1.0', previous: '1.0.5' });
    writeJson(path.join(otaRoot(), 'boot.json'), { failures: 3, version: '1.1.0' });
    expect(resolve().source).toBe('builtin');
    expect(readPointer()).toEqual({
      abi: ABI,
      blacklist: ['1.1.0'],
      channel: null,
      current: null,
      previous: null,
      staged: null,
    });
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'never treats prototype key %s as a verified core',
    (version) => {
      const dir = path.join(otaRoot(), 'cores', version);
      fs.mkdirSync(path.join(dir, 'dist/main'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'dist/main/index.js'), 'unsigned');
      writePointer({ current: version });
      const core = resolve();
      expect(core.source).toBe('builtin');
      expect(core.log.join('\n')).toMatch(/rejected/);
    },
  );

  it('nulls current and blacklists after 3 boot failures without previous', () => {
    writeExternal('1.1.0');
    writePointer({ current: '1.1.0' });
    writeJson(path.join(otaRoot(), 'boot.json'), { failures: 3, version: '1.1.0' });
    expect(resolve().source).toBe('builtin');
    expect(readPointer()).toEqual({
      abi: ABI,
      blacklist: ['1.1.0'],
      channel: null,
      current: null,
      previous: null,
      staged: null,
    });
  });

  it('ignores a pointer written by another shell abi and leaves it untouched', () => {
    writeExternal('1.1.0');
    writePointer({ abi: 'b'.repeat(64), current: '1.1.0' });
    const raw = fs.readFileSync(pointerFile(), 'utf8');
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toMatch(/abi/);
    expect(fs.readFileSync(pointerFile(), 'utf8')).toBe(raw);
  });

  it('promotes a valid staged core on cold boot and writes the pointer back', () => {
    writeExternal('1.1.0');
    writeExternal('1.2.0');
    writePointer({ blacklist: [], current: '1.1.0', previous: null, staged: '1.2.0' });
    const core = resolve();
    expect(core.source).toBe('external');
    expect(core.manifest.version).toBe('1.2.0');
    expect(readBoot()).toEqual({ failures: 1, healthy: false, version: '1.2.0' });
    expect(readPointer()).toEqual({
      abi: ABI,
      blacklist: [],
      channel: null,
      current: '1.2.0',
      previous: '1.1.0',
      staged: null,
    });
  });

  it('drops current and previous when the builtin core has a higher or equal seq', () => {
    writeCore(builtinDir, '2.0.0', { seq: 5 });
    writeExternal('1.1.0', { seq: 5 });
    writeExternal('1.0.5', { seq: 4 });
    writePointer({ blacklist: [], current: '1.1.0', previous: '1.0.5', staged: null });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.manifest.version).toBe('2.0.0');
    expect(core.log).toContain('core 1.1.0 seq 5 superseded by builtin seq 5');
    expect(readPointer()).toMatchObject({ blacklist: [], current: null, previous: null });
    expect(readBoot().version).toMatch(/^builtin@/);
  });

  it('still loads an external core whose seq is above the builtin', () => {
    writeCore(builtinDir, '2.0.0', { seq: 5 });
    writeExternal('2.0.0-6', { seq: 6 });
    writePointer({ current: '2.0.0-6' });
    expect(resolve().manifest.version).toBe('2.0.0-6');
  });

  it('drops an external core from another channel than the pointer names', () => {
    writeCore(builtinDir, '2.0.0', { channel: 'stable', seq: 5 });
    writeExternal('1.1.0', { channel: 'canary', seq: 300 });
    writePointer({ channel: 'stable', current: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log).toContain('core 1.1.0 channel canary != stable');
    expect(readPointer()).toMatchObject({ channel: 'stable', current: null, previous: null });
  });

  it('does not let a builtin from another channel supersede the selected channel core', () => {
    writeCore(builtinDir, '2.0.0', { channel: 'stable', seq: 5 });
    writeExternal('1.1.0', { channel: 'canary', seq: 3 });
    writePointer({ channel: 'canary', current: '1.1.0' });
    expect(resolve().manifest.version).toBe('1.1.0');
  });

  it('discards a staged core superseded by the builtin instead of promoting it', () => {
    writeCore(builtinDir, '2.0.0', { seq: 5 });
    writeExternal('1.2.0', { seq: 3 });
    writePointer({ blacklist: [], current: null, previous: null, staged: '1.2.0' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(readPointer()).toMatchObject({ current: null, previous: null, staged: null });
  });

  it('keeps current when staged fails verification', () => {
    writeExternal('1.1.0');
    writeExternal('1.2.0', {
      mutate: (dir) => fs.writeFileSync(path.join(dir, 'dist/main/index.js'), 'tampered'),
    });
    writePointer({ current: '1.1.0', staged: '1.2.0' });
    const raw = fs.readFileSync(pointerFile(), 'utf8');
    const core = resolve();
    expect(core.manifest.version).toBe('1.1.0');
    expect(core.log.join('\n')).toMatch(/staged 1\.2\.0/);
    expect(fs.readFileSync(pointerFile(), 'utf8')).toBe(raw);
  });

  it('skips blacklisted versions', () => {
    writeExternal('1.1.0');
    writeExternal('1.0.5');
    writePointer({ blacklist: ['1.1.0'], current: '1.1.0', previous: '1.0.5' });
    const core = resolve();
    expect(core.manifest.version).toBe('1.0.5');
    expect(core.log.join('\n')).toMatch(/1\.1\.0 rejected: blacklisted/);
  });

  it('rejects version names with path separators', () => {
    writeCore(path.join(tmp, 'evil'), '1.1.0');
    writePointer({ current: '../../evil' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toMatch(/version/);

    writePointer({ current: '..' });
    expect(resolve().source).toBe('builtin');
  });

  it('rejects a signed manifest whose tree omits dist/main/index.js', () => {
    writeExternal('1.1.0', {
      mutate: (_, manifest) => {
        delete manifest.signature;
        manifest.tree = manifest.tree.filter((entry) => entry.path !== 'dist/main/index.js');
        Object.assign(manifest, signManifest(manifest));
      },
    });
    writePointer({ current: '1.1.0' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toMatch(/dist\/main\/index\.js/);
  });

  it('markHealthy resets failures for external cores', () => {
    writeExternal('1.1.0');
    writePointer({ current: '1.1.0' });
    writeJson(path.join(otaRoot(), 'boot.json'), { failures: 2, version: '1.1.0' });
    const core = resolve();
    expect(readBoot()).toEqual({ failures: 3, healthy: false, version: '1.1.0' });
    core.markHealthy();
    expect(readBoot()).toEqual({ failures: 0, healthy: true, version: '1.1.0' });
    resolve();
    expect(readBoot()).toEqual({ failures: 1, healthy: true, version: '1.1.0' });
  });

  it('counts builtin boots under a builtin key and markHealthy resets them', () => {
    resolve();
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(readBoot()).toEqual({ failures: 2, healthy: false, version: 'builtin@1.0.0' });
    core.markHealthy();
    expect(readBoot()).toEqual({ failures: 0, healthy: true, version: 'builtin@1.0.0' });
  });

  it('asks for rescue after 3 unhealthy builtin boots', () => {
    for (let i = 0; i < 3; i += 1) expect(resolve().source).toBe('builtin');
    const core = resolve();
    expect(core.source).toBe('rescue');
    expect(core.log.join('\n')).toMatch(/builtin@1\.0\.0 failed 3 boots/);
    expect(readBoot().failures).toBe(3);
  });

  it('gives a new builtin version a fresh boot budget', () => {
    writeJson(path.join(otaRoot(), 'boot.json'), { failures: 3, version: 'builtin@0.9.0' });
    expect(resolve().source).toBe('builtin');
    expect(readBoot()).toEqual({ failures: 1, healthy: false, version: 'builtin@1.0.0' });
  });

  it('markBroken on builtin sends the next launch to rescue', () => {
    resolve().markBroken();
    expect(resolve().source).toBe('rescue');
  });

  it('markBroken on an external core falls back to previous on the next launch', () => {
    writeExternal('1.1.0');
    writeExternal('1.0.5');
    writePointer({ current: '1.1.0', previous: '1.0.5' });
    resolve().markBroken();
    const core = resolve();
    expect(core.manifest.version).toBe('1.0.5');
    expect(readPointer().blacklist).toEqual(['1.1.0']);
  });

  it('boots builtin even when boot state cannot be written', () => {
    const blocked = path.join(tmp, 'blocked');
    fs.writeFileSync(blocked, '');
    const core = resolveCore({ abi: ABI, builtinDir, publicKey: publicKeyPem, userData: blocked });
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toMatch(/builtin boot count failed/);
    expect(() => core.markHealthy()).not.toThrow();
    expect(() => core.markBroken()).not.toThrow();
  });

  it('never throws on corrupt pointer or missing core dir', () => {
    fs.mkdirSync(otaRoot(), { recursive: true });
    fs.writeFileSync(path.join(otaRoot(), 'pointer.json'), '{not json');
    expect(resolve().source).toBe('builtin');
    writePointer({ current: '9.9.9' });
    const core = resolve();
    expect(core.source).toBe('builtin');
    expect(core.log.join('\n')).toMatch(/9\.9\.9/);
  });
});
