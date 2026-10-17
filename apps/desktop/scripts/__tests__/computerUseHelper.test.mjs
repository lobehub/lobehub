import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMPUTER_USE_HELPER_SIGN_IGNORE,
  downloadComputerUseHelper,
  embedComputerUseHelper,
  resolveComputerUseHelperAsset,
  resolveComputerUseHelperVersion,
  verifyComputerUseHelper,
} from '../computerUseHelper.mjs';

const SIGNATURE = [
  'Executable=/x/LobeHub Computer Use.app/Contents/MacOS/auv-device-helper-macos',
  'Identifier=com.lobehub.lobehub-desktop.computer-use',
  'TeamIdentifier=4684H589ZU',
].join('\n');

const createExecute = ({ signature = SIGNATURE, version = '0.0.33' } = {}) =>
  vi.fn((command, args) => {
    if (command === 'codesign' && args[0] === '--display') {
      return { status: 0, stderr: signature, stdout: '' };
    }
    if (command === 'plutil') return { status: 0, stderr: '', stdout: `${version}\n` };
    return { status: 0, stderr: '', stdout: '' };
  });

const archive = Buffer.from('helper zip');
const checksum = createHash('sha256').update(archive).digest('hex');

const createFetch = ({ body = archive, sum = checksum } = {}) =>
  vi.fn(async (url) => {
    const payload = url.endsWith('.sha256') ? Buffer.from(`${sum}  helper.zip\n`) : body;
    return { arrayBuffer: async () => payload, ok: true, status: 200 };
  });

const logger = { info: vi.fn() };

describe('Computer Use helper packaging', () => {
  let cacheDir;

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'computer-use-test-'));
  });

  afterEach(async () => {
    await fs.rm(cacheDir, { force: true, recursive: true });
  });

  it('selects the helper release matching the pinned AUV CLI', () => {
    const version = resolveComputerUseHelperVersion({ dependencies: { '@auv-js/cli': '0.0.33' } });
    expect(resolveComputerUseHelperAsset({ arch: 'arm64', version })).toEqual({
      checksumUrl:
        'https://github.com/lobehub/lobehub-auv/releases/download/v0.0.33/LobeHub-Computer-Use-0.0.33-arm64.zip.sha256',
      name: 'LobeHub-Computer-Use-0.0.33-arm64.zip',
      url: 'https://github.com/lobehub/lobehub-auv/releases/download/v0.0.33/LobeHub-Computer-Use-0.0.33-arm64.zip',
    });
    expect(() =>
      resolveComputerUseHelperVersion({ dependencies: { '@auv-js/cli': '^0.0.33' } }),
    ).toThrow(/exact version/);
    expect(() => resolveComputerUseHelperAsset({ arch: 'ia32', version })).toThrow();
  });

  it('keeps electron-builder from re-signing anything inside the helper bundle', () => {
    const pattern = new RegExp(COMPUTER_USE_HELPER_SIGN_IGNORE);
    const helper = '/out/LobeHub.app/Contents/Library/Helpers/LobeHub Computer Use.app';
    expect(pattern.test(helper)).toBe(true);
    expect(pattern.test(`${helper}/Contents/MacOS/auv-device-helper-macos`)).toBe(true);
    expect(pattern.test('/out/LobeHub.app')).toBe(false);
    expect(pattern.test('/out/LobeHub.app/Contents/Resources/bin/auv')).toBe(false);
  });

  it('downloads once and reuses the cached zip while its checksum matches', async () => {
    const fetchImpl = createFetch();
    const first = await downloadComputerUseHelper({
      arch: 'x64',
      cacheDir,
      fetchImpl,
      logger,
      version: '0.0.33',
    });
    await expect(fs.readFile(first)).resolves.toEqual(archive);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await downloadComputerUseHelper({
      arch: 'x64',
      cacheDir,
      fetchImpl,
      logger,
      version: '0.0.33',
    });
    // Only the checksum is fetched again.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects a zip that does not match the published checksum', async () => {
    await expect(
      downloadComputerUseHelper({
        arch: 'arm64',
        cacheDir,
        fetchImpl: createFetch({ body: Buffer.from('tampered') }),
        logger,
        version: '0.0.33',
      }),
    ).rejects.toThrow(/Checksum mismatch/);
  });

  it('accepts only the notarized LobeHub identity at the expected version', () => {
    const appPath = '/x/LobeHub Computer Use.app';
    const execute = createExecute();
    verifyComputerUseHelper(appPath, { execute, version: '0.0.33' });
    expect(execute.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
      ['codesign', '--verify'],
      ['codesign', '--display'],
      ['xcrun', 'stapler'],
      ['plutil', '-extract'],
    ]);

    expect(() =>
      verifyComputerUseHelper(appPath, {
        execute: createExecute({ signature: SIGNATURE.replace('4684H589ZU', 'OTHERTEAM1') }),
      }),
    ).toThrow(/Unexpected Computer Use helper signature/);
    expect(() =>
      verifyComputerUseHelper(appPath, {
        execute: createExecute({ version: '0.0.32' }),
        version: '0.0.33',
      }),
    ).toThrow(/expected 0.0.33/);
  });

  it('retries stapler validate when the ticket lookup loses its network connection', () => {
    const appPath = '/x/LobeHub Computer Use.app';
    const base = createExecute();
    let staplerCalls = 0;
    const execute = vi.fn((command, args) => {
      if (command === 'xcrun' && ++staplerCalls < 3) {
        return { status: 68, stderr: 'The network connection was lost.', stdout: '' };
      }
      return base(command, args);
    });
    const sleep = vi.fn();
    const logger = { warn: vi.fn() };

    verifyComputerUseHelper(appPath, { execute, logger, sleep, version: '0.0.33' });

    expect(staplerCalls).toBe(3);
    expect(sleep.mock.calls).toEqual([[5000], [15_000]]);
    expect(logger.warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringMatching(/attempt 1\/3\), retrying in 5s: .*exited with 68/),
      expect.stringMatching(/attempt 2\/3\), retrying in 15s: .*exited with 68/),
    ]);
  });

  it('fails when stapler validate keeps failing', () => {
    const base = createExecute();
    const execute = vi.fn((command, args) =>
      command === 'xcrun'
        ? { status: 68, stderr: 'The network connection was lost.', stdout: '' }
        : base(command, args),
    );
    const sleep = vi.fn();
    const logger = { warn: vi.fn() };

    expect(() =>
      verifyComputerUseHelper('/x/LobeHub Computer Use.app', { execute, logger, sleep }),
    ).toThrow(/stapler validate .* exited with 68/);
    expect(execute.mock.calls.filter(([command]) => command === 'xcrun')).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('copies the verified helper into Contents/Library/Helpers with ditto', async () => {
    const execute = createExecute();
    const appPath = path.join(cacheDir, 'LobeHub.app');
    const destination = await embedComputerUseHelper({
      appPath,
      arch: 'arm64',
      cacheDir,
      execute,
      fetchImpl: createFetch(),
      logger,
      version: '0.0.33',
    });

    expect(destination).toBe(
      path.join(appPath, 'Contents', 'Library', 'Helpers', 'LobeHub Computer Use.app'),
    );
    const dittoCalls = execute.mock.calls.filter(([command]) => command === 'ditto');
    expect(dittoCalls[0][1].slice(0, 3)).toEqual([
      '-x',
      '-k',
      path.join(cacheDir, 'LobeHub-Computer-Use-0.0.33-arm64.zip'),
    ]);
    expect(dittoCalls[1][1][1]).toBe(destination);
  });
});
