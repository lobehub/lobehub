import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../api/client';
import { registerVerifyCommand } from './verify';
import { registerAcceptanceCommands } from './verifyAcceptance';

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn() }));

const content = '---\nname: acceptance\nmetadata:\n  version: "0.5.0"\n---\n# Acceptance\n';
const bundle = {
  content,
  files: {
    'LICENSE': 'Apache-2.0',
    'references/report.md': '# Reports',
    'scripts/capture.cjs': 'console.log("capture");',
    'surfaces/cli.md': '# CLI',
  },
  identifier: 'acceptance',
  name: 'acceptance',
  source: {
    commit: 'a'.repeat(40),
    path: 'skills/acceptance',
    repository: 'lobehub/acceptance',
    ref: 'HEAD',
  },
  version: '0.5.0',
};

describe('acceptance skill installation', () => {
  let directory: string;
  const query = vi.fn();
  const trackSkillInstall = vi.fn();

  const run = async (...args: string[]) => {
    const program = new Command().version('0.0.55');
    program.exitOverride();
    registerAcceptanceCommands(program);
    await program.parseAsync(['node', 'lh', 'acceptance', ...args, '--dir', directory, '--json']);
  };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'acceptance-distribution-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    query.mockReset().mockResolvedValue(bundle);
    trackSkillInstall.mockReset().mockResolvedValue(undefined);
    vi.mocked(getTrpcClient)
      .mockReset()
      .mockResolvedValue({
        verify: { getSkillBundle: { query }, trackSkillInstall: { mutate: trackSkillInstall } },
      } as unknown as Awaited<ReturnType<typeof getTrpcClient>>);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(directory, { force: true, recursive: true });
  });

  it('installs every source resource through the authenticated server and wires Claude', async () => {
    await mkdir(path.join(directory, '.claude'));

    await run('install');

    const skillDir = path.join(directory, '.agents/skills/acceptance');
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe(content);
    for (const [file, expected] of Object.entries(bundle.files)) {
      expect(await readFile(path.join(skillDir, file), 'utf8')).toBe(expected);
    }
    expect(await readlink(path.join(directory, '.claude/skills'))).toBe('../.agents/skills');
    expect(getTrpcClient).toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith({ identifier: 'acceptance' });
    expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string)).toMatchObject({
      skill: 'acceptance',
      version: '0.5.0',
    });
  });

  it('emits links[] plus the legacy link alias for the Claude result', async () => {
    await mkdir(path.join(directory, '.claude'));
    await mkdir(path.join(directory, '.roo'));

    await run('install');

    const result = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string);
    expect(result.links).toEqual([
      { kind: 'linked', link: '.claude/skills', target: '../.agents/skills' },
      { kind: 'linked', link: '.roo/skills', target: '../.agents/skills' },
    ]);
    // Legacy alias keeps reporting the Claude wiring result, not links[0].
    expect(result.link).toEqual({
      kind: 'linked',
      link: '.claude/skills',
      target: '../.agents/skills',
    });
  });

  it('emits link { kind: none } when no Claude signal exists', async () => {
    await mkdir(path.join(directory, '.roo'));

    await run('install');

    const result = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string);
    expect(result.link).toEqual({ kind: 'none' });
    expect(result.links).toEqual([
      { kind: 'linked', link: '.roo/skills', target: '../.agents/skills' },
    ]);
  });

  it('leaves the existing skill and stale resources untouched when an update cannot download', async () => {
    const skillDir = path.join(directory, '.agents/skills/acceptance');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), 'existing skill');
    await writeFile(path.join(skillDir, 'old.md'), 'existing resource');
    query.mockRejectedValueOnce(new Error('Download unavailable'));

    await expect(run('update')).rejects.toThrow('Download unavailable');

    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe('existing skill');
    expect(await readFile(path.join(skillDir, 'old.md'), 'utf8')).toBe('existing resource');
    expect(trackSkillInstall).not.toHaveBeenCalled();
  });

  it('preserves existing files during install, then replaces them and removes stale files on update', async () => {
    await run('install');
    const skillDir = path.join(directory, '.agents/skills/acceptance');
    await writeFile(path.join(skillDir, 'SKILL.md'), 'local copy');
    await writeFile(path.join(skillDir, 'old.md'), 'stale reference');

    await run('install');
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe('local copy');
    expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string).skipped).toContain(
      'SKILL.md',
    );

    await run('update');
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe(content);
    await expect(readFile(path.join(skillDir, 'old.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string).removed).toEqual([
      'old.md',
    ]);
  });

  it.each(['0.5.0', 'v0.5.0'])('supports forcing an install from tag %s', async (version) => {
    await run('install');
    const skillPath = path.join(directory, '.agents/skills/acceptance/SKILL.md');
    await writeFile(skillPath, 'local copy');
    query.mockResolvedValueOnce({ ...bundle, source: { ...bundle.source, ref: 'v0.5.0' } });

    await run('install', '--force', '--skill-version', version);

    expect(await readFile(skillPath, 'utf8')).toBe(content);
    expect(query).toHaveBeenLastCalledWith({ identifier: 'acceptance', version: '0.5.0' });
  });

  it.each(['init', 'install'])('keeps the deprecated verify %s alias working', async (command) => {
    const program = new Command();
    registerVerifyCommand(program);
    await program.parseAsync([
      'node',
      'lh',
      'verify',
      command,
      '--skill',
      'verify',
      '--dir',
      directory,
    ]);
    expect(await readFile(path.join(directory, '.agents/skills/acceptance/SKILL.md'), 'utf8')).toBe(
      content,
    );
    expect(getTrpcClient).toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith({ identifier: 'verify' });
  });

  it('keeps login required and preserves installed files when authentication fails', async () => {
    await run('install');
    vi.mocked(getTrpcClient).mockRejectedValueOnce(new Error('Not authenticated'));

    await expect(run('update')).rejects.toThrow('Not authenticated');
    expect(await readFile(path.join(directory, '.agents/skills/acceptance/SKILL.md'), 'utf8')).toBe(
      content,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a matching tag whose declared version differs from the requested version', async () => {
    await run('install');
    query.mockResolvedValueOnce({
      ...bundle,
      source: { ...bundle.source, ref: 'v0.5.0' },
      version: '0.4.3',
    });

    await expect(run('update', '--skill-version', 'v0.5.0')).rejects.toThrow(
      'Requested acceptance skill 0.5.0 from tag v0.5.0, but the server returned version 0.4.3',
    );
    expect(await readFile(path.join(directory, '.agents/skills/acceptance/SKILL.md'), 'utf8')).toBe(
      content,
    );
  });

  it.each([undefined, 'HEAD', 'v0.4.3'])(
    'rejects a matching version with source ref %s before changing installed files',
    async (ref) => {
      await mkdir(path.join(directory, '.claude'));
      await run('install');
      const skillDir = path.join(directory, '.agents/skills/acceptance');
      await writeFile(path.join(skillDir, 'old.md'), 'keep this resource');
      query.mockResolvedValueOnce({
        ...bundle,
        content: content.replace('# Acceptance', '# Different content with the same version'),
        files: { 'unexpected.md': 'must not be written' },
        source: ref === undefined ? undefined : { ...bundle.source, ref },
      });

      await expect(run('update', '--skill-version', 'v0.5.0')).rejects.toThrow(
        `from ${ref ?? 'an unknown source'}. Update your server to support skill tag selection.`,
      );

      expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe(content);
      for (const [file, expected] of Object.entries(bundle.files)) {
        expect(await readFile(path.join(skillDir, file), 'utf8')).toBe(expected);
      }
      expect(await readFile(path.join(skillDir, 'old.md'), 'utf8')).toBe('keep this resource');
      await expect(readFile(path.join(skillDir, 'unexpected.md'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readlink(path.join(directory, '.claude/skills'))).toBe('../.agents/skills');
    },
  );

  it('allows an unpinned update from a legacy server without source metadata', async () => {
    await run('install');
    const updated = content.replace('# Acceptance', '# Updated default content');
    const { source: _source, ...legacyBundle } = bundle;
    query.mockResolvedValueOnce({ ...legacyBundle, content: updated });

    await run('update');

    expect(await readFile(path.join(directory, '.agents/skills/acceptance/SKILL.md'), 'utf8')).toBe(
      updated,
    );
    expect(query).toHaveBeenLastCalledWith({ identifier: 'acceptance' });
  });

  it('reports installs and explicit updates even when the bundle version is unchanged', async () => {
    await run('install');
    expect(trackSkillInstall).toHaveBeenLastCalledWith(
      { event: 'install', identifier: 'acceptance', version: '0.5.0' },
      { signal: expect.any(AbortSignal) },
    );

    await run('update');
    expect(trackSkillInstall).toHaveBeenLastCalledWith(
      { event: 'update', identifier: 'acceptance', version: '0.5.0' },
      { signal: expect.any(AbortSignal) },
    );
    expect(trackSkillInstall).toHaveBeenCalledTimes(2);
  });

  it('counts a forced install as an install, not an update', async () => {
    await run('install', '--force');

    expect(trackSkillInstall).toHaveBeenCalledExactlyOnceWith(
      { event: 'install', identifier: 'acceptance', version: '0.5.0' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('does not report a no-op install where every file was skipped', async () => {
    await run('install');
    trackSkillInstall.mockClear();

    await run('install');

    expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string).skipped).toContain(
      'SKILL.md',
    );
    expect(trackSkillInstall).not.toHaveBeenCalled();
  });

  it('still succeeds when the server cannot record the install', async () => {
    trackSkillInstall.mockRejectedValueOnce(new Error('unknown procedure'));

    await run('install');

    expect(await readFile(path.join(directory, '.agents/skills/acceptance/SKILL.md'), 'utf8')).toBe(
      content,
    );
    expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string)).toMatchObject({
      skill: 'acceptance',
    });
  });

  it('bounds tracking latency and cancels a stalled request without failing the install', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    trackSkillInstall.mockImplementationOnce((_input, options?: { signal: AbortSignal }) => {
      signal = options?.signal;
      started();
      return new Promise<void>((_resolve, reject) => {
        if (!signal) return reject(new Error('Missing cancellation signal'));
        signal.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    });

    const installing = run('install');
    await requestStarted;
    await vi.advanceTimersByTimeAsync(2999);
    expect(console.log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await installing;

    expect(signal?.aborted).toBe(true);
    expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string).written).toContain(
      'SKILL.md',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not report an install when files could not be written', async () => {
    await writeFile(path.join(directory, '.agents'), 'not a directory');

    await expect(run('install')).rejects.toThrow();

    expect(trackSkillInstall).not.toHaveBeenCalled();
  });
});
