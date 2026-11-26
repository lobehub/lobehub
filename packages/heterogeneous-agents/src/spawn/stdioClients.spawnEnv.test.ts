import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { RpcStdioClient } from '../rpc/rpcStdioClient';
import { AcpStdioClient } from './acpStdioClient';

const { resolveCliSpawnPlan, spawnManaged } = vi.hoisted(() => ({
  resolveCliSpawnPlan: vi.fn(async (command: string, args: string[]) => ({ args, command })),
  spawnManaged: vi.fn(),
}));

vi.mock('./cliSpawn', () => ({ resolveCliSpawnPlan }));
vi.mock('@lobechat/utils/managedProcess', () => ({ spawnManaged }));

const fakeChild = () =>
  Object.assign(new EventEmitter(), {
    pid: 1,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
  });

// A Windows npm shim is unwrapped by finding `node` on PATH. The child's PATH
// (the one detection validated) must be the one searched, not the host's
// startup PATH, or a CLI installed after launch fails with EINVAL / ENOENT.
const env = { PATH: 'C:\\Users\\x\\AppData\\Roaming\\npm;C:\\Windows' };
const common = { args: ['acp'], commandPath: 'codex.cmd', cwd: '/work', env, onStderr: vi.fn() };

describe('stdio clients resolve their spawn plan against the child env', () => {
  it('ACP', async () => {
    spawnManaged.mockReturnValue(fakeChild());
    await new AcpStdioClient({ ...common, onMessage: vi.fn(), onRawMessage: vi.fn() }).start();

    expect(resolveCliSpawnPlan).toHaveBeenLastCalledWith('codex.cmd', ['acp'], env);
  });

  it('RPC', async () => {
    spawnManaged.mockReturnValue(fakeChild());
    await new RpcStdioClient({ ...common, onMessage: vi.fn() }).start();

    expect(resolveCliSpawnPlan).toHaveBeenLastCalledWith('codex.cmd', ['acp'], env);
  });
});
