import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureStagedSrtWin } from '../srtWinStaging';

const realPlatform = process.platform;
const setPlatform = (platform: string) =>
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });

let tmp: string;
let programData: string | undefined;
let sourceExe: string;

/**
 * This directory is created on the END USER's machine and stays there, so its
 * name is part of what a distribution ships. Left hardcoded, a rebranded build
 * leaves a directory named after upstream in `C:\ProgramData` — permanent,
 * visible in any audit, and unrelated to the product the user installed.
 */
describe('staged helper location', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-staging-'));
    programData = process.env.PROGRAMDATA;
    process.env.PROGRAMDATA = path.join(tmp, 'ProgramData');

    // `resolveVersion` walks three levels up from the exe looking for a
    // package.json, so mirror the real layout rather than a bare file.
    sourceExe = path.join(tmp, 'pkg', 'vendor', 'srt-win', 'x64', 'srt-win.exe');
    fs.mkdirSync(path.dirname(sourceExe), { recursive: true });
    fs.writeFileSync(sourceExe, 'binary');
    fs.writeFileSync(path.join(tmp, 'pkg', 'package.json'), JSON.stringify({ version: '9.9.9' }));

    setPlatform('win32');
    delete process.env.LOBE_SANDBOX_STAGING_NAME;
  });

  afterEach(() => {
    setPlatform(realPlatform);
    if (programData === undefined) delete process.env.PROGRAMDATA;
    else process.env.PROGRAMDATA = programData;
    delete process.env.LOBE_SANDBOX_STAGING_NAME;
    fs.rmSync(tmp, { force: true, recursive: true });
  });

  it('uses the upstream name when nothing overrides it', () => {
    const staged = ensureStagedSrtWin(sourceExe);

    expect(staged).toBeDefined();
    expect(staged).toContain(path.join('ProgramData', 'LobeHub', 'sandbox'));
    expect(fs.existsSync(staged!)).toBe(true);
  });

  it('uses the distribution name when one is set', () => {
    process.env.LOBE_SANDBOX_STAGING_NAME = 'Acme Work';

    const staged = ensureStagedSrtWin(sourceExe);

    expect(staged).toContain(path.join('ProgramData', 'AcmeWork', 'sandbox'));
    expect(staged).not.toContain('LobeHub');
  });

  it('strips anything that would relocate the staging tree', () => {
    process.env.LOBE_SANDBOX_STAGING_NAME = '../../Windows/System32';

    const staged = ensureStagedSrtWin(sourceExe);

    expect(staged).toContain(path.join('ProgramData', 'WindowsSystem32', 'sandbox'));
    expect(staged).not.toContain('..');
  });

  it('falls back to the upstream name when the override sanitises to nothing', () => {
    for (const junk of ['///', '..', '.', '...']) {
      process.env.LOBE_SANDBOX_STAGING_NAME = junk;

      expect(ensureStagedSrtWin(sourceExe)).toContain(path.join('ProgramData', 'LobeHub'));
    }
  });
});
