import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildEphemeralListingCommand,
  EPHEMERAL_SANDBOX_IDLE_MS,
  EPHEMERAL_SANDBOX_MAX_ENTRIES,
  isHeteroExecLaunch,
  listEphemeralSandboxFiles,
  parseEphemeralListing,
  settledEphemeralSandboxStatus,
} from '../ephemeralFiles';

const NOW = 1_800_000_000_000;

describe('settledEphemeralSandboxStatus', () => {
  it('cannot tell without a record store, so the sandbox has to be asked', () => {
    expect(settledEphemeralSandboxStatus(undefined, NOW)).toBeUndefined();
  });

  it('reads a conversation with no record as not started', () => {
    expect(settledEphemeralSandboxStatus(null, NOW)).toBe('notStarted');
    expect(settledEphemeralSandboxStatus({ aliveAt: NOW }, NOW)).toBe('notStarted');
  });

  it('asks the sandbox while it may still be alive', () => {
    expect(settledEphemeralSandboxStatus({ activeAt: NOW - 60_000 }, NOW)).toBeUndefined();
  });

  it('answers recycled past the idle window, counting reads that kept it alive', () => {
    const activeAt = NOW - EPHEMERAL_SANDBOX_IDLE_MS - 1;

    expect(settledEphemeralSandboxStatus({ activeAt }, NOW)).toBe('expired');
    expect(settledEphemeralSandboxStatus({ activeAt, aliveAt: NOW - 1000 }, NOW)).toBeUndefined();
  });

  it('keeps asking the sandbox while a long-running agent holds it open', () => {
    const activeAt = NOW - EPHEMERAL_SANDBOX_IDLE_MS - 1;

    expect(
      settledEphemeralSandboxStatus({ activeAt, keepAliveUntil: NOW + 60_000 }, NOW),
    ).toBeUndefined();
    expect(settledEphemeralSandboxStatus({ activeAt, keepAliveUntil: NOW - 1 }, NOW)).toBe(
      'expired',
    );
  });

  it('answers recycled once a read found a new sandbox, until the agent works in it', () => {
    expect(
      settledEphemeralSandboxStatus({ activeAt: NOW - 5000, recycledAt: NOW - 1000 }, NOW),
    ).toBe('expired');
    expect(
      settledEphemeralSandboxStatus({ activeAt: NOW - 1000, recycledAt: NOW - 5000 }, NOW),
    ).toBeUndefined();
  });
});

describe('parseEphemeralListing', () => {
  it('reads the root and every entry relative to it', () => {
    expect(
      parseEphemeralListing(
        ['__LOBE_SANDBOX_ROOT__\t/workspace', 'd\tout', 'f\tout/report.md', 'l\tlink'].join('\n'),
      ),
    ).toEqual({
      entries: [
        { isDirectory: true, name: 'out', path: 'out' },
        { isDirectory: false, name: 'report.md', path: 'out/report.md' },
        { isDirectory: false, name: 'link', path: 'link' },
      ],
      root: '/workspace',
      truncated: false,
    });
  });

  it('drops lines that would point outside the root', () => {
    expect(
      parseEphemeralListing(
        ['__LOBE_SANDBOX_ROOT__\t/workspace', 'f\t../etc/passwd', 'f\t/etc/passwd', 'noise'].join(
          '\n',
        ),
      )?.entries,
    ).toEqual([]);
  });

  it('says when the listing stopped at the cap', () => {
    const lines = Array.from({ length: EPHEMERAL_SANDBOX_MAX_ENTRIES + 1 }, (_, i) => `f\tf${i}`);
    const listing = parseEphemeralListing(['__LOBE_SANDBOX_ROOT__\t/w', ...lines].join('\n'));

    expect(listing?.entries).toHaveLength(EPHEMERAL_SANDBOX_MAX_ENTRIES);
    expect(listing?.truncated).toBe(true);
  });

  it('refuses output without a root', () => {
    expect(parseEphemeralListing('f\ta.txt')).toBeUndefined();
  });
});

describe('buildEphemeralListingCommand', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { force: true, recursive: true });
    dir = undefined;
  });

  it('lists the starting directory, keeping dependency and credential folders closed', () => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ephemeral-listing-')));
    mkdirSync(path.join(dir, 'out'));
    writeFileSync(path.join(dir, 'out', 'report.md'), '# hi');
    mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), '');
    mkdirSync(path.join(dir, '.creds'));
    writeFileSync(path.join(dir, '.creds', 'env'), 'TOKEN=secret');
    const deep = path.join(dir, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
    mkdirSync(deep, { recursive: true });
    writeFileSync(path.join(deep, 'deep.txt'), 'deep');

    const stdout = execFileSync('/bin/sh', ['-c', buildEphemeralListingCommand()], {
      cwd: dir,
      encoding: 'utf8',
    });
    const listing = parseEphemeralListing(stdout);

    expect(listing?.root).toBe(dir);
    const paths = listing?.entries.map((entry) => entry.path) ?? [];
    expect(paths.filter((p) => !p.startsWith('a')).sort()).toEqual([
      '.creds',
      'node_modules',
      'out',
      'out/report.md',
    ]);
    // Ten levels down is still listed: nothing is cut off silently by depth.
    expect(paths).toContain('a/b/c/d/e/f/g/h/i/deep.txt');
    expect(listing?.truncated).toBe(false);
  });
});

describe('listEphemeralSandboxFiles', () => {
  const ready = {
    result: { stdout: '__LOBE_SANDBOX_ROOT__\t/workspace\nf\tnotes.md\n' },
    success: true,
  };

  it('answers from the record without starting a sandbox', async () => {
    const callTool = vi.fn();

    await expect(
      listEphemeralSandboxFiles({ activity: null, callTool, topicId: 't' }),
    ).resolves.toEqual({ status: 'notStarted' });
    await expect(
      listEphemeralSandboxFiles({
        activity: { activeAt: Date.now() - EPHEMERAL_SANDBOX_IDLE_MS - 1 },
        callTool,
        topicId: 't',
      }),
    ).resolves.toEqual({ status: 'expired' });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('lists a sandbox that may still be alive', async () => {
    const callTool = vi.fn().mockResolvedValue(ready);

    await expect(
      listEphemeralSandboxFiles({ activity: { activeAt: Date.now() }, callTool, topicId: 't' }),
    ).resolves.toEqual({
      entries: [{ isDirectory: false, name: 'notes.md', path: 'notes.md' }],
      root: '/workspace',
      status: 'ready',
      truncated: false,
    });
    expect(callTool).toHaveBeenCalledWith(
      'runCommand',
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it('reports a session the call had to recreate as recycled, not as an empty tree', async () => {
    const callTool = vi.fn().mockResolvedValue({ ...ready, sessionExpiredAndRecreated: true });

    await expect(
      listEphemeralSandboxFiles({ activity: undefined, callTool, topicId: 't' }),
    ).resolves.toEqual({ status: 'expired' });
  });

  it('fails rather than show an empty tree when the sandbox could not be read', async () => {
    const callTool = vi.fn().mockResolvedValue({ error: { message: 'boom' }, success: false });

    await expect(
      listEphemeralSandboxFiles({ activity: { activeAt: Date.now() }, callTool, topicId: 't' }),
    ).rejects.toThrow('boom');
  });
});

describe('isHeteroExecLaunch', () => {
  it('matches the launches the execution plane keeps alive', () => {
    expect(isHeteroExecLaunch('runCommand', { command: 'lh hetero exec --type codex' })).toBe(true);
    expect(isHeteroExecLaunch('runCommand', { command: "cd w && 'lh' 'hetero' 'exec'" })).toBe(
      true,
    );
    expect(isHeteroExecLaunch('runCommand', { heteroExec: true })).toBe(true);
    expect(isHeteroExecLaunch('runCommand', { command: 'echo flh hetero exec' })).toBe(false);
    expect(isHeteroExecLaunch('execScript', { command: 'lh hetero exec' })).toBe(false);
  });
});
