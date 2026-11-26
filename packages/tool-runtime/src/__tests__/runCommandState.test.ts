import { describe, expect, it, vi } from 'vitest';

import {
  type ILocalSystemService,
  LocalSystemExecutionRuntime,
} from '../LocalSystemExecutionRuntime';

const createRuntime = (result: Record<string, unknown>) =>
  new LocalSystemExecutionRuntime({
    runCommand: vi.fn().mockResolvedValue(result),
  } as unknown as ILocalSystemService);

describe('ComputerRuntime.runCommand state', () => {
  // The local shell reports `output = stdout + stderr` next to both streams;
  // persisting it stored the command's output twice in `message_plugins.state`.
  it('drops an output that is exactly stdout + stderr', async () => {
    const runtime = createRuntime({
      exit_code: 1,
      output: 'built\nwarning: deprecated\n',
      stderr: 'warning: deprecated\n',
      stdout: 'built\n',
      success: true,
    });

    const result = await runtime.runCommand({ command: 'make' });

    expect(result.state).not.toHaveProperty('output');
    expect(result.state).toMatchObject({
      exitCode: 1,
      stderr: 'warning: deprecated\n',
      stdout: 'built\n',
    });
    expect(result.content).toContain('built');
  });

  it('drops an output that only repeats stdout', async () => {
    const runtime = createRuntime({ exit_code: 0, output: 'ok\n', stdout: 'ok\n', success: true });

    const result = await runtime.runCommand({ command: 'echo ok' });

    expect(result.state).not.toHaveProperty('output');
    expect(result.state).toMatchObject({ stdout: 'ok\n' });
  });

  it('keeps an output that carries something stdout does not', async () => {
    // A backend that prepends a notice to stdout only, or reports no stdout.
    const runtime = createRuntime({
      exit_code: 0,
      output: 'plain output',
      stdout: '[environment] ready\n\nplain output',
      success: true,
    });

    const result = await runtime.runCommand({ command: 'ls' });

    expect(result.state).toMatchObject({
      output: 'plain output',
      stdout: '[environment] ready\n\nplain output',
    });
  });

  it('keeps output when the backend reports no stdout', async () => {
    const runtime = createRuntime({
      output: 'Working directory notice',
      shell_id: 's1',
      success: true,
    });

    const result = await runtime.runCommand({ background: true, command: 'sleep 9' });

    expect(result.state).toMatchObject({ output: 'Working directory notice' });
  });
});
