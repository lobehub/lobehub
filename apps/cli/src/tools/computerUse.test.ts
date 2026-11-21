import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeComputerUseCall, resolveComputerUseDevice } from './computerUse';

// A stand-in `auv` that echoes its arguments, or fails like AUV does with a
// JSON envelope on stdout for the `fail.now` command.
const FAKE_AUV = `#!/bin/sh
if [ "$2" = "fail.now" ]; then printf '{"error":"window_not_found"}'; echo 'no window' >&2; exit 4; fi
printf '{"args":"%s"}' "$*"
`;

describe.skipIf(process.platform === 'win32')('Computer Use on lh connect', () => {
  let dir: string;
  let binary: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lh-auv-'));
    binary = path.join(dir, 'auv');
    await writeFile(binary, FAKE_AUV);
    await chmod(binary, 0o755);
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  describe('resolveComputerUseDevice', () => {
    it('leaves Computer Use off without --auv', async () => {
      await expect(resolveComputerUseDevice(undefined)).resolves.toBeUndefined();
    });

    it('stores runs under the CLI config directory', async () => {
      await expect(resolveComputerUseDevice(binary)).resolves.toEqual({
        binaryPath: binary,
        storeRoot: path.join(os.homedir(), '.lobehub', 'auv', 'runs'),
      });
    });

    it('rejects a missing or non-executable binary', async () => {
      await expect(resolveComputerUseDevice(path.join(dir, 'missing'))).rejects.toThrow(
        'no file at',
      );
      await chmod(binary, 0o644);
      await expect(resolveComputerUseDevice(binary)).rejects.toThrow('is not executable');
    });
  });

  describe('executeComputerUseCall', () => {
    it('runs auv invoke with --json and the managed store root', async () => {
      const device = { binaryPath: binary, storeRoot: path.join(dir, 'runs') };

      const result = await executeComputerUseCall(
        device,
        'runCommand',
        JSON.stringify({ argv: ['invoke', 'display.capture'], reasoning: 'look' }),
      );

      expect(result.success).toBe(true);
      expect(result.state).toEqual({
        argv: ['invoke', 'display.capture'],
        exitCode: 0,
        output: { args: `invoke display.capture --json --store-root ${device.storeRoot}` },
      });
    });

    it('returns a failed command with its structured output', async () => {
      const device = { binaryPath: binary, storeRoot: path.join(dir, 'runs') };

      const result = await executeComputerUseCall(
        device,
        'runCommand',
        JSON.stringify({ argv: ['invoke', 'fail.now'] }),
      );

      expect(result).toMatchObject({
        error: 'no window',
        state: { exitCode: 4, output: { error: 'window_not_found' } },
        success: false,
      });
    });

    it('refuses calls when Computer Use is off or the argv is not allowed', async () => {
      const off = await executeComputerUseCall(
        undefined,
        'runCommand',
        JSON.stringify({ argv: ['invoke', 'display.list'] }),
      );
      expect(off).toMatchObject({ error: expect.stringContaining('--auv'), success: false });

      const device = { binaryPath: binary, storeRoot: path.join(dir, 'runs') };
      const shell = await executeComputerUseCall(
        device,
        'runCommand',
        JSON.stringify({ argv: ['serve'] }),
      );
      expect(shell.success).toBe(false);
    });
  });
});
