/**
 * Regression: the local-system executor must forward ALL grepContent params
 * (glob, output_mode, -i, -A/-B/-C, -n, multiline, head_limit, type, scope)
 * to the runtime — not strip them down to {directory, pattern}.
 *
 * Pre-fix, agent calls with `scope` + `glob` + `output_mode` + `-i` reached the
 * Electron IPC as `{ directory, pattern }` only. The IPC type expects `path`/`scope`
 * (not `directory`), so cwd fell back to `process.cwd()`. With no glob/include
 * filter, `tool.*name.*mcp` matched every dist/* bundle and tsbuildinfo.
 *
 * See LOBE-8666 / the agent screenshot that reported the leak.
 */
import { describe, expect, it, vi } from 'vitest';

// The executor module pulls in @/services/electron/localFileService (renderer alias).
// In the package's vitest env that alias doesn't resolve — stub it.
vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    editLocalFile: vi.fn(),
    getCommandOutput: vi.fn(),
    globFiles: vi.fn(),
    grepContent: vi.fn(),
    killCommand: vi.fn(),
    listLocalFiles: vi.fn(),
    moveLocalFiles: vi.fn(),
    readLocalFile: vi.fn(),
    readLocalFiles: vi.fn(),
    renameLocalFile: vi.fn(),
    runCommand: vi.fn(),
    searchLocalFiles: vi.fn(),
    writeFile: vi.fn(),
  },
}));

const { localSystemExecutor } = await import('../client/executor');

describe('localSystemExecutor.grepContent — params forwarding', () => {
  it('forwards glob, output_mode, -i, and scope through to the runtime', async () => {
    const runtime = (localSystemExecutor as any).runtime as {
      grepContent: (args: any) => Promise<unknown>;
    };

    const spy = vi.spyOn(runtime, 'grepContent').mockResolvedValue({
      content: 'Found 0 matches in 0 locations:',
      state: { matches: [], pattern: 'tool.*name.*mcp', totalMatches: 0 },
      success: true,
    });

    await localSystemExecutor.grepContent({
      '-i': true,
      'glob': '**/*.ts',
      'output_mode': 'files_with_matches',
      'pattern': 'tool.*name.*mcp',
      'scope': '/Users/arvinxx/CodeProjects/LobeHub/lobehub-desktop',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const forwarded = spy.mock.calls[0][0] as Record<string, unknown>;

    // The critical fields the LLM filled in MUST reach the runtime.
    expect(forwarded).toMatchObject({
      '-i': true,
      'glob': '**/*.ts',
      'output_mode': 'files_with_matches',
      'pattern': 'tool.*name.*mcp',
      // resolveArgsWithScope copies scope into `path` so the downstream
      // resolveSearchPath can pick it up; either field reaching the runtime is fine.
      'path': '/Users/arvinxx/CodeProjects/LobeHub/lobehub-desktop',
    });

    // And it must NOT have been collapsed to the stripped {directory, pattern} shape.
    expect(forwarded).not.toEqual({
      directory: expect.any(String),
      pattern: expect.any(String),
    });

    spy.mockRestore();
  });

  it('keeps optional flags intact when present', async () => {
    const runtime = (localSystemExecutor as any).runtime as {
      grepContent: (args: any) => Promise<unknown>;
    };

    const spy = vi.spyOn(runtime, 'grepContent').mockResolvedValue({
      content: '',
      state: { matches: [], pattern: 'x', totalMatches: 0 },
      success: true,
    });

    await localSystemExecutor.grepContent({
      '-A': 3,
      '-B': 2,
      '-C': 1,
      '-i': true,
      '-n': true,
      'head_limit': 50,
      'multiline': true,
      'pattern': 'x',
      'scope': '/repo',
      'type': 'ts',
    });

    expect(spy.mock.calls[0][0]).toMatchObject({
      '-A': 3,
      '-B': 2,
      '-C': 1,
      '-i': true,
      '-n': true,
      'head_limit': 50,
      'multiline': true,
      'pattern': 'x',
      'path': '/repo',
      'type': 'ts',
    });

    spy.mockRestore();
  });
});

describe('localSystemExecutor.listFiles — limit forwarding', () => {
  it('forwards the manifest-exposed `limit` to the runtime', async () => {
    const runtime = (localSystemExecutor as any).runtime as {
      listFiles: (args: any) => Promise<unknown>;
    };
    const spy = vi.spyOn(runtime, 'listFiles').mockResolvedValue({
      content: '',
      state: { files: [], totalCount: 0 },
      success: true,
    });

    await localSystemExecutor.listFiles({ limit: 50, path: '/tmp', sortBy: 'name' });

    expect(spy.mock.calls[0][0]).toMatchObject({
      directoryPath: '/tmp',
      limit: 50,
      sortBy: 'name',
    });

    spy.mockRestore();
  });
});

describe('localSystemExecutor.getCommandOutput — filter forwarding', () => {
  it('forwards the manifest-exposed `filter` to the runtime', async () => {
    const runtime = (localSystemExecutor as any).runtime as {
      getCommandOutput: (args: any) => Promise<unknown>;
    };
    const spy = vi.spyOn(runtime, 'getCommandOutput').mockResolvedValue({
      content: '',
      state: { newOutput: '', running: false, success: true },
      success: true,
    });

    await localSystemExecutor.getCommandOutput({ filter: 'ERROR', shell_id: 'sh-1' });

    expect(spy.mock.calls[0][0]).toMatchObject({
      commandId: 'sh-1',
      filter: 'ERROR',
    });

    spy.mockRestore();
  });
});

describe('localSystemExecutor.runCommand — background field normalization', () => {
  it('mirrors `run_in_background` to `background` so RunCommandState.isBackground is correct', async () => {
    const runtime = (localSystemExecutor as any).runtime as {
      runCommand: (args: any) => Promise<unknown>;
    };
    const spy = vi.spyOn(runtime, 'runCommand').mockResolvedValue({
      content: '',
      state: { isBackground: true, success: true },
      success: true,
    });

    await localSystemExecutor.runCommand({
      command: 'sleep 60',
      description: 'sleep',
      run_in_background: true,
    });

    const forwarded = spy.mock.calls[0][0] as Record<string, unknown>;
    // Both fields present: `background` for ComputerRuntime state, `run_in_background` for IPC.
    expect(forwarded).toMatchObject({
      background: true,
      command: 'sleep 60',
      run_in_background: true,
    });

    spy.mockRestore();
  });
});
