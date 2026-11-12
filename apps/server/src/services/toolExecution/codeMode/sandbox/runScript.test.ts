import { describe, expect, it, vi } from 'vitest';

import { runCodeModeScript, type RunScriptOptions } from './runScript';

const run = (code: string, overrides: Partial<RunScriptOptions> = {}) =>
  runCodeModeScript({
    code,
    maxLogChars: 2000,
    maxToolCalls: 10,
    memoryLimitMb: 64,
    onToolCall: async () => ({ ok: true, value: null }),
    timeoutMs: 5000,
    toolNames: ['github.list_issues', 'github.create_issue'],
    ...overrides,
  });

describe('runCodeModeScript', () => {
  it('returns the script value and its console output', async () => {
    const outcome = await run(`
      const items: number[] = [1, 2, 3];
      console.log('sum', items.reduce((a, b) => a + b, 0));
      return { count: items.length };
    `);

    expect(outcome).toMatchObject({
      logs: ['sum 6'],
      ok: true,
      toolCallCount: 0,
      value: { count: 3 },
    });
  });

  it('forwards tool calls through the bridge and resolves them in the script', async () => {
    const onToolCall = vi.fn(async (name: string, argsJson: string) => ({
      ok: true as const,
      value: { args: JSON.parse(argsJson), name },
    }));

    const outcome = await run(
      `
      const [a, b] = await Promise.all([
        tools.github.list_issues({ state: 'open' }),
        callTool('github.create_issue', { title: 'x' }),
      ]);
      return [a, b];
    `,
      { onToolCall },
    );

    expect(onToolCall).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(true);
    expect(outcome.toolCallCount).toBe(2);
    expect(outcome.value).toEqual([
      { args: { state: 'open' }, name: 'github.list_issues' },
      { args: { title: 'x' }, name: 'github.create_issue' },
    ]);
  });

  it('throws a failed tool call inside the script with its code', async () => {
    const outcome = await run(
      `
      try {
        await tools.github.create_issue({});
        return 'unreachable';
      } catch (error) {
        return { code: error.code, message: error.message };
      }
    `,
      {
        onToolCall: async () => ({
          error: { code: 'TOOL_DISABLED', message: 'disabled by the user' },
          ok: false,
        }),
      },
    );

    expect(outcome.value).toEqual({ code: 'TOOL_DISABLED', message: 'disabled by the user' });
  });

  it('reports an uncaught error as a failed run', async () => {
    const outcome = await run(`throw new Error('boom');`);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({ code: 'SCRIPT_ERROR', message: 'Error: boom' });
  });

  it('reports a syntax error without running anything', async () => {
    const onToolCall = vi.fn();
    const outcome = await run(`await tools.github.list_issues({ `, { onToolCall });

    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('SCRIPT_SYNTAX_ERROR');
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('stops a script that never finishes once its time is up', async () => {
    const started = Date.now();
    const outcome = await run(`await Promise.resolve(); while (true) {}`, { timeoutMs: 300 });

    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('stops a script waiting on a tool call once its time is up', async () => {
    const outcome = await run(`return await tools.github.list_issues({});`, {
      onToolCall: () => new Promise(() => {}),
      timeoutMs: 300,
    });

    expect(outcome.error?.code).toBe('TIMEOUT');
  });

  it('fails the call past the per-run tool call limit', async () => {
    const outcome = await run(
      `
      const results = [];
      for (let i = 0; i < 3; i++) {
        try { await tools.github.list_issues({ i }); results.push('ok'); }
        catch (error) { results.push(error.code); }
      }
      return results;
    `,
      { maxToolCalls: 2 },
    );

    expect(outcome.value).toEqual(['ok', 'ok', 'TOOL_CALL_LIMIT']);
  });

  it('caps console output', async () => {
    const outcome = await run(
      `for (let i = 0; i < 100; i++) console.log('x'.repeat(50)); return 1;`,
      {
        maxLogChars: 200,
      },
    );

    expect(outcome.logs.join('\n').length).toBeLessThanOrEqual(200);
    expect(outcome.logsTruncated).toBe(true);
  });

  it('cancels the run when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = run(`await tools.github.list_issues({});`, {
      onToolCall: () => new Promise(() => {}),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);

    expect((await pending).error?.code).toBe('ABORTED');
  });

  describe('isolation', () => {
    it('exposes no Node globals to the script', async () => {
      const outcome = await run(
        `return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof Buffer];`,
      );

      expect(outcome.value).toEqual([
        'undefined',
        'undefined',
        'undefined',
        'undefined',
        'undefined',
      ]);
    });

    it('cannot reach the host realm through constructors', async () => {
      const outcome = await run(`
        const attempts = [
          () => this.constructor.constructor('return process')(),
          () => tools.constructor.constructor('return process')(),
          () => callTool.constructor('return process')(),
          () => console.log.constructor('return process')(),
          () => eval('1 + 1'),
        ];
        return attempts.map((attempt) => {
          try { const value = attempt(); return typeof value; }
          catch (error) { return 'blocked'; }
        });
      `);

      expect(outcome.value).toEqual(['blocked', 'blocked', 'blocked', 'blocked', 'blocked']);
    });
  });
});
