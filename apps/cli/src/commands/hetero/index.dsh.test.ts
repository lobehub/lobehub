import type * as HeteroSpawn from '@lobechat/heterogeneous-agents/spawn';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHeteroCommand } from './index';

const { resolveDsh, spawnDsh } = vi.hoisted(() => ({
  resolveDsh: vi.fn(),
  spawnDsh: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', async (importOriginal) => ({
  ...(await importOriginal<typeof HeteroSpawn>()),
  resolveDshSpawnCommand: resolveDsh,
  spawnDshAcpSession: spawnDsh,
}));
vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn() }));

const runExec = async (argv: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerHeteroCommand(program);
  await program
    .parseAsync(['hetero', 'exec', '--type', 'deepseek-harness', ...argv], { from: 'user' })
    .catch((error: Error) => {
      if (!error.message.startsWith('__exit__')) throw error;
    });
};

describe('hetero exec — DeepSeek Harness launch', () => {
  let exit: ReturnType<typeof vi.spyOn>;
  const dispose = vi.fn().mockResolvedValue(undefined);
  const prompt = vi.fn(async function* () {
    yield { data: { model: 'deepseek-chat' }, operationId: 'op-dsh', type: 'stream_start' };
    yield { data: { finishReason: 'stop' }, operationId: 'op-dsh', type: 'agent_runtime_end' };
  });

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__${code}`);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    spawnDsh.mockReturnValue({ dispose, prompt, sessionId: 'dsh-session-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('runs the harness through its acp-profile session', async () => {
    resolveDsh.mockResolvedValue({ command: 'dsh' });

    await runExec(['--prompt', 'say hi', '--cwd', '/tmp/work', '--model', 'deepseek-chat']);

    expect(spawnDsh).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/work',
        model: 'deepseek-chat',
        resumeSessionId: undefined,
      }),
    );
    expect(prompt).toHaveBeenCalledWith('say hi');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('launches the validated dsh with the PATH that found it', async () => {
    // e.g. `npm i -g @deepseek-ai/dsh` after the host started: the registry
    // PATH has the npm dir, the process PATH does not.
    resolveDsh.mockResolvedValue({
      command: 'C:\\Users\\x\\AppData\\Roaming\\npm\\dsh.cmd',
      pathEnv: 'C:\\Users\\x\\AppData\\Roaming\\npm;C:\\Windows',
    });

    await runExec(['--prompt', 'say hi']);

    expect(resolveDsh).toHaveBeenCalledWith(undefined);
    expect(spawnDsh).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'C:\\Users\\x\\AppData\\Roaming\\npm\\dsh.cmd',
        env: expect.objectContaining({ PATH: 'C:\\Users\\x\\AppData\\Roaming\\npm;C:\\Windows' }),
      }),
    );
  });

  it('passes a custom --command through to the resolver', async () => {
    resolveDsh.mockResolvedValue({ command: '/opt/dsh-wrapped' });

    await runExec(['--prompt', 'say hi', '--command', '/opt/dsh-wrapped']);

    expect(resolveDsh).toHaveBeenCalledWith('/opt/dsh-wrapped');
    expect(spawnDsh).toHaveBeenCalledWith(expect.objectContaining({ command: '/opt/dsh-wrapped' }));
  });
});
