import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildWslSpawnPlan,
  decodeWslOutput,
  findWslCommandCandidates,
  formatWslCommand,
  getSettledWslPathEnv,
  getWslPathEnv,
  invalidateWslCache,
  parseWslCommand,
  parseWslDistroList,
  parseWslProbeOutput,
  toWslPath,
} from './wsl';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'win32') };
});
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return { ...actual, spawn: vi.fn() };
});

const platformMock = vi.mocked(os.platform);
const spawnMock = vi.mocked(childProcess.spawn);

interface FakeWslRun {
  args: string[];
  input: string;
}

/** Answer each wsl.exe run from `respond`; records argv and what was piped to stdin. */
const fakeWsl = (respond: (args: string[]) => { code?: number; stdout?: Buffer | string }) => {
  const runs: FakeWslRun[] = [];
  spawnMock.mockImplementation(((_command: string, args: string[]) => {
    const child = new EventEmitter() as childProcess.ChildProcess;
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const run: FakeWslRun = { args, input: '' };
    runs.push(run);
    stdin.on('data', (chunk) => (run.input += chunk.toString()));
    Object.assign(child, { kill: vi.fn(), stdin, stdout });

    stdin.on('finish', () => {
      const { code = 0, stdout: output = '' } = respond(args);
      stdout.end(output);
      setImmediate(() => child.emit('close', code));
    });
    return child;
  }) as never);
  return runs;
};

const probeOutput = (lines: string[]) => ['Welcome to Ubuntu', '', ...lines, ''].join('\n');

beforeEach(() => {
  invalidateWslCache();
  platformMock.mockReturnValue('win32');
  spawnMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('wsl commands', () => {
  it('round-trips a distro and a linux path', () => {
    const command = formatWslCommand({
      distro: 'Ubuntu-24.04',
      linuxPath: '/home/me/.local/bin/agent',
    });

    expect(command).toBe('wsl://Ubuntu-24.04/home/me/.local/bin/agent');
    expect(parseWslCommand(command)).toEqual({
      distro: 'Ubuntu-24.04',
      linuxPath: '/home/me/.local/bin/agent',
    });
  });

  it('rejects anything that is not a wsl:// command', () => {
    expect(parseWslCommand('agent')).toBeUndefined();
    expect(parseWslCommand('C:\\tools\\agent.exe')).toBeUndefined();
    expect(parseWslCommand('wsl://Ubuntu')).toBeUndefined();
    expect(parseWslCommand('wsl:///home/me/agent')).toBeUndefined();
  });

  it('translates Windows paths into the distro', () => {
    expect(toWslPath('C:\\Users\\me\\project')).toBe('/mnt/c/Users/me/project');
    expect(toWslPath('D:/work')).toBe('/mnt/d/work');
    expect(toWslPath('\\\\wsl.localhost\\Ubuntu\\home\\me')).toBe('/home/me');
    expect(toWslPath('\\\\wsl$\\Ubuntu\\tmp\\x')).toBe('/tmp/x');
    expect(toWslPath('--model')).toBe('--model');
    expect(toWslPath('acp')).toBe('acp');
  });
});

describe('buildWslSpawnPlan', () => {
  const command = { distro: 'Ubuntu', linuxPath: '/home/me/.local/bin/agent' };

  it('runs the linux binary through wsl.exe with the login PATH and translated path args', () => {
    const plan = buildWslSpawnPlan(
      command,
      ['acp', '--mcp-config', 'C:\\Temp\\mcp.json', '--workspace=C:\\repo'],
      undefined,
      '/home/me/.nvm/versions/node/v22/bin:/usr/bin',
    );

    expect(plan.command).toMatch(/[\\/]System32[\\/]wsl\.exe$/);
    expect(plan.args).toEqual([
      '--distribution',
      'Ubuntu',
      '--exec',
      'env',
      'PATH=/home/me/.nvm/versions/node/v22/bin:/usr/bin',
      '/home/me/.local/bin/agent',
      'acp',
      '--mcp-config',
      '/mnt/c/Temp/mcp.json',
      '--workspace=/mnt/c/repo',
    ]);
  });

  it('forwards the variables the spawn site set through WSLENV, not argv', () => {
    vi.stubEnv('LOBEHUB_JWT', 'inherited-token');
    vi.stubEnv('HOMEPATH', '\\Users\\me');
    const env = {
      ...process.env,
      CUSTOM_FLAG: '1',
      HOME: 'C:\\Users\\me',
      PATH: 'C:\\Windows',
      WSLENV: 'EXISTING/p',
    };

    const plan = buildWslSpawnPlan(command, [], env, undefined);
    const forwarded = plan.env!.WSLENV!.split(':');

    expect(forwarded).toContain('EXISTING/p');
    expect(forwarded).toContain('CUSTOM_FLAG/u');
    expect(forwarded).toContain('LOBEHUB_JWT/u');
    expect(forwarded.some((entry) => /^(?:HOME|PATH|HOMEPATH)\//i.test(entry))).toBe(false);
    expect(plan.args.join(' ')).not.toContain('inherited-token');
  });
});

describe('probe output', () => {
  it('reads the PATH and absolute command paths, skipping banners and aliases', () => {
    const probe = parseWslProbeOutput(
      probeOutput([
        '__LOBEHUB_WSL_PATH__=/home/me/.local/bin:/usr/bin',
        '__LOBEHUB_WSL_CMD__=agent=/home/me/.local/bin/agent',
        '__LOBEHUB_WSL_CMD__=claude=alias claude=~/.claude/local/claude',
        '__LOBEHUB_WSL_CMD__=dsh=/home/me/.nvm/versions/node/v22/bin/dsh',
      ]),
    );

    expect(probe.pathEnv).toBe('/home/me/.local/bin:/usr/bin');
    expect([...probe.commands]).toEqual([
      ['agent', '/home/me/.local/bin/agent'],
      ['dsh', '/home/me/.nvm/versions/node/v22/bin/dsh'],
    ]);
  });

  it('decodes the UTF-16 distro list of older wsl.exe builds and drops Docker Desktop', () => {
    const utf16 = Buffer.from('\uFEFFUbuntu\r\ndocker-desktop\r\nDebian\r\n', 'utf16le');

    expect(parseWslDistroList(decodeWslOutput(utf16))).toEqual(['Ubuntu', 'Debian']);
    expect(parseWslDistroList(decodeWslOutput(Buffer.from('Ubuntu\n')))).toEqual(['Ubuntu']);
  });
});

describe('findWslCommandCandidates', () => {
  it('finds the command in every distro that has it, default distro first', async () => {
    const runs = fakeWsl((args) => {
      if (args[0] === '--list') return { stdout: 'Ubuntu\nDebian\n' };
      if (args[1] === 'Ubuntu') {
        return {
          stdout: probeOutput([
            '__LOBEHUB_WSL_PATH__=/home/me/bin:/usr/bin',
            '__LOBEHUB_WSL_CMD__=agent=/home/me/.local/bin/agent',
          ]),
        };
      }
      return { stdout: probeOutput(['__LOBEHUB_WSL_PATH__=/usr/bin']) };
    });

    await expect(findWslCommandCandidates('agent')).resolves.toEqual([
      'wsl://Ubuntu/home/me/.local/bin/agent',
    ]);
    // The probe script goes in over stdin, so Windows quoting never touches it.
    const probe = runs.find((run) => run.args[1] === 'Ubuntu')!;
    expect(probe.args.slice(0, 6)).toEqual([
      '--distribution',
      'Ubuntu',
      '--exec',
      'sh',
      '-s',
      '--',
    ]);
    expect(probe.args).toEqual(expect.arrayContaining(['agent', 'dsh', 'cursor-agent']));
    expect(probe.input).toContain('-ilc');
    // One probe per distro answers every command and the spawn-time PATH.
    await findWslCommandCandidates('dsh');
    await expect(getWslPathEnv('Ubuntu')).resolves.toBe('/home/me/bin:/usr/bin');
    expect(getSettledWslPathEnv('Ubuntu')).toBe('/home/me/bin:/usr/bin');
    expect(runs).toHaveLength(3);
  });

  it('finds nothing without WSL, and never asks off Windows', async () => {
    fakeWsl(() => ({ code: 1 }));
    await expect(findWslCommandCandidates('agent')).resolves.toEqual([]);

    platformMock.mockReturnValue('darwin');
    spawnMock.mockReset();
    await expect(findWslCommandCandidates('agent')).resolves.toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('retries a distro whose probe failed instead of pinning the failure', async () => {
    let attempt = 0;
    fakeWsl((args) => {
      if (args[0] === '--list') return { stdout: 'Ubuntu\n' };
      attempt += 1;
      return attempt === 1
        ? { code: 1 }
        : { stdout: probeOutput(['__LOBEHUB_WSL_CMD__=agent=/usr/local/bin/agent']) };
    });

    await expect(findWslCommandCandidates('agent')).resolves.toEqual([]);
    await expect(findWslCommandCandidates('agent')).resolves.toEqual([
      'wsl://Ubuntu/usr/local/bin/agent',
    ]);
  });
});
