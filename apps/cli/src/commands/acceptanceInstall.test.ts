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
    vi.mocked(getTrpcClient)
      .mockReset()
      .mockResolvedValue({
        verify: { getSkillBundle: { query } },
      } as unknown as Awaited<ReturnType<typeof getTrpcClient>>);
  });

  afterEach(async () => {
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

  it('leaves the existing skill and stale resources untouched when an update cannot download', async () => {
    const skillDir = path.join(directory, '.agents/skills/acceptance');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), 'existing skill');
    await writeFile(path.join(skillDir, 'old.md'), 'existing resource');
    query.mockRejectedValueOnce(new Error('Download unavailable'));

    await expect(run('update')).rejects.toThrow('Download unavailable');

    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe('existing skill');
    expect(await readFile(path.join(skillDir, 'old.md'), 'utf8')).toBe('existing resource');
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

  it('supports forcing an install and selecting a tag', async () => {
    await run('install');
    const skillPath = path.join(directory, '.agents/skills/acceptance/SKILL.md');
    await writeFile(skillPath, 'local copy');
    await run('install', '--force', '--skill-version', '0.5.0');
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

  it('does not overwrite a pinned installation when an older server ignores the requested version', async () => {
    await run('install');
    query.mockResolvedValueOnce({ ...bundle, version: '0.4.3' });

    await expect(run('update', '--skill-version', 'v0.5.0')).rejects.toThrow(
      'Requested acceptance skill 0.5.0, but the server returned 0.4.3',
    );
    expect(await readFile(path.join(directory, '.agents/skills/acceptance/SKILL.md'), 'utf8')).toBe(
      content,
    );
  });
});
