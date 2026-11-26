import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCliSpawnPlan } from './cliSpawn';
import { detectDshCommand } from './dshAcpSession';
import { detectHeterogeneousCliCommand, invalidateLoginShellPathCache } from './resolveCliCommand';

// The whole Windows → WSL chain, run for real on a POSIX host: detection asks a
// stand-in `wsl.exe` (which execs inside this machine instead of a distro), the
// probe script runs in a real login shell, validation and launch go through the
// real spawn plan. Only `platform()` is faked.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'win32') };
});

const execFileAsync = promisify(execFile);
const isPosix = process.platform !== 'win32';

let root: string;
const wslExe = () => `${root}\\System32\\wsl.exe`;

const writeExecutable = async (file: string, source: string) => {
  await mkdir(path.posix.dirname(file), { recursive: true });
  await writeFile(file, source);
  await chmod(file, 0o755);
};

beforeAll(async () => {
  if (!isPosix) return;
  root = await mkdtemp(path.join(os.tmpdir(), 'lobehub-wsl-'));

  // `wsl.exe --list --quiet` and `wsl.exe --distribution <d> --exec <cmd> …`, at
  // `${SystemRoot}\\System32\\wsl.exe` — on this POSIX host, one file next to `root`.
  await writeExecutable(
    wslExe(),
    `#!/bin/sh
if [ "$1" = "--list" ]; then printf 'FakeLinux\\n'; exit 0; fi
[ "$1" = "--distribution" ] && [ "$2" = "FakeLinux" ] || exit 2
shift 2
[ "$1" = "--exec" ] || exit 2
shift
exec "$@"
`,
  );
  await writeExecutable(
    path.join(root, 'linux-bin', 'agent'),
    `#!/bin/sh
case "$1" in
  --help) printf 'Usage: agent [options] [command] [prompt...]\\n\\nStart the Cursor Agent\\n' ;;
  *) printf 'cursor-run:%s\\n' "$*" ;;
esac
`,
  );
  await writeExecutable(path.join(root, 'linux-bin', 'dsh'), "#!/bin/sh\nprintf '0.9.0\\n'\n");
});

afterAll(async () => {
  if (!root) return;
  await rm(root, { force: true, recursive: true });
  await rm(wslExe(), { force: true });
});

beforeEach(() => {
  invalidateLoginShellPathCache();
  vi.stubEnv('SystemRoot', root);
  vi.stubEnv('LOCALAPPDATA', path.join(root, 'no-such-dir'));
  vi.stubEnv('APPDATA', path.join(root, 'no-such-dir'));
  // The fake distro's login shell inherits this PATH, as a real one has its own.
  vi.stubEnv('PATH', `${path.join(root, 'linux-bin')}:${process.env.PATH}`);
  vi.stubEnv('SHELL', '/bin/sh');
});

describe.runIf(isPosix)('agents inside WSL, end to end', () => {
  it('finds Cursor in WSL when Windows has none, and launches it through wsl.exe', async () => {
    const status = await detectHeterogeneousCliCommand('cursor', 'agent');

    expect(status).toMatchObject({
      available: true,
      path: `wsl://FakeLinux${path.join(root, 'linux-bin', 'agent')}`,
    });

    const plan = await resolveCliSpawnPlan(status.path!, ['acp', '--trust'], process.env);
    expect(plan.command).toBe(wslExe());

    const { stdout } = await execFileAsync(plan.command, plan.args, { env: plan.env });
    expect(stdout.trim()).toBe('cursor-run:acp --trust');
  });

  it('finds the DeepSeek Harness CLI in WSL', async () => {
    const status = await detectDshCommand();

    expect(status).toMatchObject({
      available: true,
      path: `wsl://FakeLinux${path.join(root, 'linux-bin', 'dsh')}`,
      version: '0.9.0',
    });
  });

  it('reports a CLI missing from both sides as unavailable', async () => {
    const status = await detectHeterogeneousCliCommand('qoder', 'qodercli');

    expect(status.available).toBe(false);
  });
});
