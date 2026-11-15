import {
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
} from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import {
  buildInitializeProbeMessage,
  describeStdioSpawnFailure,
  hasInitializeResponse,
  isBareConnectionClosedError,
  MCPClient,
  MCPConnectionError,
  PrecheckOutputStream,
  selectDiagnosticOutputLines,
} from './client';

describe('describeStdioSpawnFailure', () => {
  it('diagnoses ENOENT spawn errors with the command and install guidance', () => {
    const message = describeStdioSpawnFailure({
      command: 'kali-mcp',
      spawnCode: 'ENOENT',
    });

    expect(message).toContain('kali-mcp');
    expect(message).toContain('not found');
    expect(message).toContain('npx`/`.cmd`');
  });

  it('maps Windows numeric errno -4058 (ENOENT) to the not-found diagnosis', () => {
    // Windows spawn failures surface as a numeric errno without a symbolic code
    const message = describeStdioSpawnFailure({
      command: 'goatjg_mcp',
      errno: -4058,
    });

    expect(message).toContain('goatjg_mcp');
    expect(message).toContain('not found');
  });

  it('diagnoses permission errors', () => {
    const message = describeStdioSpawnFailure({
      command: '/usr/local/bin/kali-server',
      spawnCode: 'EACCES',
    });

    expect(message).toContain('not executable');
    expect(message).toContain('chmod +x');
  });

  it('detects the pt-BR "path not found" loader message from the real vent', () => {
    // Real-world stderr from vent msg_PjF7YECkH0nA67ddyY (Windows, pt-BR locale)
    const message = describeStdioSpawnFailure({
      command: 'mcpkali_note',
      exitCode: 1,
      stderr: 'O sistema não pode encontrar o caminho especificado.',
    });

    expect(message).toContain('mcpkali_note');
    expect(message).toContain('path not found');
    expect(message).toContain('Reinstall');
  });

  it('detects the zh-CN loader message', () => {
    const message = describeStdioSpawnFailure({
      command: 'kali_mcp',
      exitCode: 1,
      stderr: '系统找不到指定的路径。',
    });

    expect(message).toContain('path not found');
  });

  it('falls back to the exit-code diagnosis for unrelated stderr', () => {
    const message = describeStdioSpawnFailure({
      command: 'broken-server',
      exitCode: 127,
      stderr: 'some unrelated crash output',
    });

    expect(message).toContain('exited immediately with code 127');
  });

  it('diagnoses a zero-code exit without MCP handshake as a startup failure', () => {
    const message = describeStdioSpawnFailure({
      command: 'one-shot-wrapper',
      exitCode: 0,
      stdout: 'starting up',
    });

    expect(message).toContain('exited (code 0)');
    expect(message).toContain('without completing the MCP handshake');
  });

  it('diagnoses a zero-code exit with an error line printed on stdout', () => {
    const message = describeStdioSpawnFailure({
      command: 'kali-wrapper',
      exitCode: 0,
      stdout: 'Error: config file missing',
    });

    expect(message).toContain('exited (code 0)');
    expect(message).toContain('kali-wrapper');
  });

  it('reports the crash signal for signal-only exits (exitCode null)', () => {
    // Node sets exitCode === null and populates `signal` when killed by one
    const message = describeStdioSpawnFailure({
      command: 'segfaulting-server',
      exitCode: null,
      signal: 'SIGSEGV',
    });

    expect(message).toContain('segfaulting-server');
    expect(message).toContain('terminated by signal SIGSEGV');
    expect(message).not.toContain('not found');
  });

  it('reports a signal crash with no output distinctly', () => {
    const message = describeStdioSpawnFailure({
      command: 'aborting-server',
      exitCode: null,
      signal: 'SIGABRT',
    });

    expect(message).toContain('terminated by signal SIGABRT');
    expect(message).toContain('no output');
  });

  it('detects the pt-BR "path not found" loader message printed on stdout', () => {
    // Some launchers print the loader error on stdout instead of stderr
    const message = describeStdioSpawnFailure({
      command: 'mcpkali_note',
      exitCode: 1,
      stderr: '',
      stdout: 'O sistema não pode encontrar o caminho especificado.',
    });

    expect(message).toContain('mcpkali_note');
    expect(message).toContain('path not found');
    expect(message).toContain('Reinstall');
  });

  it('falls back to the no-output diagnosis when nothing is captured', () => {
    const message = describeStdioSpawnFailure({ command: 'silent-server' });

    expect(message).toContain('produced no output');
    expect(message).toContain('silent-server');
  });
});

describe('isBareConnectionClosedError', () => {
  it('matches the SDK ConnectionClosed transport failure', () => {
    const error = new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed');

    expect(isBareConnectionClosedError(error)).toBe(true);
  });

  it('rejects server protocol errors with code -32000', () => {
    const error = new ProtocolError(-32_000, 'other transport failure');

    expect(isBareConnectionClosedError(error)).toBe(false);
  });

  it('rejects protocol/configuration failures', () => {
    const error = new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      'Invalid params — incompatible protocol version',
    );

    expect(isBareConnectionClosedError(error)).toBe(false);
  });

  it('rejects non-error values', () => {
    expect(isBareConnectionClosedError(null)).toBe(false);
    expect(isBareConnectionClosedError(undefined)).toBe(false);
    expect(isBareConnectionClosedError('Connection closed')).toBe(false);
  });
});

describe('MCPConnectionError', () => {
  it('carries stderr logs and a stable name for the existing enhancer pipeline', () => {
    const error = new MCPConnectionError('diagnosis text', ['line one', 'line two']);

    expect(error.name).toBe('MCPConnectionError');
    expect(error.message).toBe('diagnosis text');
    expect(error.stderrLogs).toEqual(['line one', 'line two']);
  });
});

describe('PrecheckOutputStream', () => {
  const CAP = 64 * 1024;

  it('accumulates small chunks without truncation', () => {
    const stream = new PrecheckOutputStream('stdout');
    stream.append(Buffer.from('hello '));
    stream.append(Buffer.from('world'));

    expect(stream.truncated).toBe(false);
    expect(stream.toString()).toBe('hello world');
  });

  it('retains the actual tail when the cap is exceeded (P2 4306325895)', () => {
    // A noisy launcher fills the cap with chatter, THEN prints the decisive
    // error. The tail buffer must keep the later error, not the first 64 KiB.
    const stream = new PrecheckOutputStream('stderr');
    stream.append(Buffer.from('x'.repeat(CAP)));
    stream.append(Buffer.from('\nnoise padding line\n'));
    stream.append(Buffer.from('final error: path not found\n'));

    const text = stream.toString();
    expect(stream.truncated).toBe(true);
    expect(text).toContain('final error: path not found');
  });

  it('decodes a multibyte character split across two chunks (P2 4306581051)', () => {
    // pt-BR "não pode encontrar o caminho especificado" — the byte sequence
    // of ã (0xC3 0xA3) must survive the chunk boundary. The pt-BR
    // path-not-found matcher lowercases the combined output.
    const stream = new PrecheckOutputStream('stderr');
    stream.append(Buffer.from('O sistema n', 'utf8'));
    stream.append(Buffer.from([0xc3, 0xa3])); // ã, split across the boundary
    stream.append(Buffer.from('o pode encontrar o caminho especificado', 'utf8'));

    const text = stream.toString();
    expect(text).toContain('não pode encontrar o caminho especificado');
    expect(text).not.toContain('\uFFFD');
    expect(text.toLowerCase()).toContain('não pode encontrar o caminho especificado');
  });

  it('drops only the head beyond the cap, aligned to a UTF-8 sequence boundary', () => {
    // 4-byte emoji per repetition guarantees a multibyte cut candidate.
    const stream = new PrecheckOutputStream('stdout');
    stream.append(Buffer.from('🎉'.repeat(30_000))); // ~120 KB, ~2x cap

    const text = stream.toString();
    expect(stream.truncated).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(CAP + 128);
    expect(text).toContain('🎉');
    expect(text).not.toContain('\uFFFD');
  });

  it('handles a single oversized chunk by keeping its last cap bytes', () => {
    const stream = new PrecheckOutputStream('stdout');
    stream.append(Buffer.from('a'.repeat(CAP + 500)));

    const text = stream.toString();
    expect(stream.truncated).toBe(true);
    expect(text).toContain('a');
    expect(text.length).toBeLessThanOrEqual(CAP + 128);
  });

  it('marks truncation once and keeps the marker stable across flushes', () => {
    const stream = new PrecheckOutputStream('stderr');
    stream.append(Buffer.from('x'.repeat(CAP)));
    const first = stream.toString();
    const second = stream.toString();

    expect(first).toContain('truncated: pre-check output cap reached');
    expect(second).toBe(first);
  });
});

describe('buildInitializeProbeMessage', () => {
  it('includes capabilities so spec-validating servers accept the probe', () => {
    const message = buildInitializeProbeMessage();
    const parsed = JSON.parse(message);

    expect(parsed.params.capabilities).toEqual({});
    expect(parsed.params.protocolVersion).toBe('2024-11-05');
    expect(parsed.params.clientInfo.name).toBe('lobe-mcp-precheck');
    expect(message.endsWith('\n')).toBe(true);
  });
});

describe('selectDiagnosticOutputLines', () => {
  const CAP = 64 * 1024;
  const makeLines = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => `${prefix} line ${i + 1}`).join('\n');

  it('keeps the tail of each stream and caps at 10 lines per stream', () => {
    const stdout = makeLines(15, 'out');
    const stderr = makeLines(15, 'err');

    const lines = selectDiagnosticOutputLines(stdout, stderr);

    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe('out line 6');
    expect(lines[9]).toBe('out line 15');
    expect(lines[10]).toBe('err line 6');
    expect(lines[19]).toBe('err line 15');
  });

  it('merges stdout then stderr preserving order', () => {
    const lines = selectDiagnosticOutputLines('out-1\nout-2', 'err-1');

    expect(lines).toEqual(['out-1', 'out-2', 'err-1']);
  });

  it('returns an empty array when both streams are empty', () => {
    expect(selectDiagnosticOutputLines('', '')).toEqual([]);
  });

  it('preserves the truncation notice when the payload fills the tail window (P2 4307065883)', () => {
    // Composed accumulator → selector: a capped stream whose retained payload
    // has ≥ 10 non-empty lines. A bare slice(-10) silently drops the prepended
    // notice, making the tail look complete even though the head was dropped.
    const stream = new PrecheckOutputStream('stderr');
    stream.append(Buffer.from('x'.repeat(CAP)));
    stream.append(Buffer.from('\n' + makeLines(12, 'err') + '\n'));
    stream.append(Buffer.from('final error: path not found\n'));

    const lines = selectDiagnosticOutputLines(stream.toString(), '');

    expect(lines[0]).toBe('[stderr truncated: pre-check output cap reached]');
    expect(lines).toContain('final error: path not found');
    expect(lines).toHaveLength(11);
  });

  it('keeps non-notice lines even when they merely look like a truncation notice', () => {
    // A payload line that merely echoes notice wording must NOT be hoisted as
    // the notice itself — only the exact marker line is hoisted. The payload
    // copy uses near-identical but distinct wording, and since the real
    // marker's stream is capped the payload copy is dropped with the head.
    const stream = new PrecheckOutputStream('stdout');
    stream.append(Buffer.from('[stdout truncated: pre-check app reached]\nreal payload line\n'));
    stream.append(Buffer.from('y'.repeat(CAP)));
    stream.append(Buffer.from('\ndecisive error\n'));

    const lines = selectDiagnosticOutputLines(stream.toString(), '');

    expect(lines[0]).toBe('[stdout truncated: pre-check output cap reached]');
    expect(lines).toContain('decisive error');
    expect(lines).not.toContain('[stdout truncated: pre-check app reached]');
  });
});

describe('hasInitializeResponse', () => {
  it('detects a JSON-RPC response to the initialize probe (id 1)', () => {
    const stdout = [
      'server starting…',
      JSON.stringify({ id: 1, jsonrpc: '2.0', result: { protocolVersion: '2024-11-05' } }),
    ].join('\n');

    expect(hasInitializeResponse(stdout)).toBe(true);
  });

  it('returns false when stdout has chatter but no probe response', () => {
    expect(hasInitializeResponse('booting\nready-ish\n')).toBe(false);
  });

  it('ignores notifications (no id) and other ids', () => {
    const stdout = [
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ id: 2, jsonrpc: '2.0', result: {} }),
    ].join('\n');

    expect(hasInitializeResponse(stdout)).toBe(false);
  });
});

describe('preCheckStdioCommand', () => {
  /**
   * Call the private pre-check directly with a short timeout so long-running
   * server cases do not stall the suite.
   */
  const runPreCheck = (
    command: string,
    args?: string[],
    timeoutMs = 1200,
  ): Promise<{ diagnosis: string; stderr: string; stdout: string; success: boolean }> =>
    (
      MCPClient.prototype as unknown as {
        preCheckStdioCommand: (p: {
          args?: string[];
          command: string;
          env?: Record<string, string>;
          timeoutMs?: number;
        }) => Promise<{ diagnosis: string; stderr: string; stdout: string; success: boolean }>;
      }
    ).preCheckStdioCommand.call({} as MCPClient, { args, command, env: {}, timeoutMs });

  it(
    'classifies on close so buffered stdout is drained before the diagnosis (P2 4305387427)',
    { timeout: 15_000 },
    async () => {
      // The child prints its error line and exits 0 immediately; Node may
      // emit `exit` before the stdout chunk drains — classification must
      // wait for `close` (or the bounded fallback) to see it.
      const result = await runPreCheck('node', [
        '-e',
        'process.stdout.write("final loader error\\n"); process.exit(0)',
      ]);

      expect(result.success).toBe(false);
      expect(result.diagnosis).toContain('without completing the MCP handshake');
      expect(result.stdout).toContain('final loader error');
    },
  );

  it(
    'does not credit exit 0 without an initialize response (round-4 regression guard)',
    { timeout: 15_000 },
    async () => {
      const result = await runPreCheck('node', ['-e', 'process.exit(0)']);

      expect(result.success).toBe(false);
      expect(result.diagnosis).toContain('without completing the MCP handshake');
    },
  );

  it(
    'classifies zero-code exits even when close is delayed by inherited pipes (exit fallback)',
    { timeout: 15_000 },
    async () => {
      // The child spawns a detached grandchild holding stdout open, then
      // exits 0. `close` stays pending on the inherited pipe; the exit-armed
      // fallback must classify with the real exit code before the 5s timeout
      // would have misreported "healthy-enough".
      const result = await runPreCheck('node', [
        '-e',
        [
          'const { spawn } = require("node:child_process");',
          'const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: ["ignore", "inherit", "inherit"], detached: false });',
          'g.unref();',
          'process.exit(0);',
        ].join(' '),
      ]);

      expect(result.success).toBe(false);
      expect(result.diagnosis).toContain('without completing the MCP handshake');
    },
  );

  it(
    'treats a long-running silent server as healthy via the timeout path (success preserved)',
    { timeout: 15_000 },
    async () => {
      const result = await runPreCheck(
        'node',
        ['-e', 'setInterval(() => {}, 1000)'],
        800, // short pre-check window: the server outlives it
      );

      expect(result.success).toBe(true);
      expect(result.diagnosis).toBe('');
    },
  );

  it(
    'terminates the whole process tree: the launcher-spawned descendant does not survive cleanup (P2 4305748076)',
    { timeout: 20_000 },
    async () => {
      // The configured command is a launcher that starts a persistent worker
      // (writes a heartbeat to a side file every 200ms) and stays alive via
      // pipes. The pre-check must tear down BOTH processes: the worker file
      // must stop growing after the pre-check window, proving no orphan.
      const heartbeat = '/tmp/lobehub-precheck-p2-heartbeat';

      const result = await runPreCheck('node', [
        '-e',
        [
          `require("node:fs").rmSync("${heartbeat}", { force: true });`,
          'const { spawn } = require("node:child_process");',
          `const w = spawn(process.execPath, ["-e", "const fs=require(\\"fs\\");const t=setInterval(()=>fs.appendFileSync(\\"${heartbeat}\\", String(Date.now())+\\"\\\\n\\"),200);process.on(\\"SIGTERM\\",()=>{clearInterval(t);process.exit(0);});"], { stdio: "ignore" });`,
          'w.unref();',
          'setInterval(() => {}, 1000);', // launcher itself stays alive → timeout path
        ].join(' '),
      ]);

      expect(result.success).toBe(true); // still-running launcher → healthy-enough path
      const settleWait = Date.now() + 5000;
      let lines = 0;
      // Give the teardown (SIGTERM → SIGKILL escalation) time to land.
      while (Date.now() < settleWait) {
        await new Promise((r) => setTimeout(r, 400));
        lines = require('node:fs').existsSync(heartbeat)
          ? require('node:fs').readFileSync(heartbeat, 'utf8').trim().split('\n').length
          : 0;
        if (lines >= 3) break; // worker was alive and writing
      }
      const stableAt = lines;

      // After teardown the heartbeat must freeze: no orphaned worker.
      await new Promise((r) => setTimeout(r, 1600));
      const finalLines = require('node:fs').existsSync(heartbeat)
        ? require('node:fs').readFileSync(heartbeat, 'utf8').trim().split('\n').length
        : 0;

      expect(stableAt).toBeGreaterThanOrEqual(3); // worker genuinely ran
      expect(finalLines).toBe(stableAt); // …and was killed with the tree
    },
  );

  it(
    'reaps worker descendants when the launcher exits on its own (zero-code path)',
    { timeout: 20_000 },
    async () => {
      // Launcher starts a worker, lets it write a few heartbeat lines, then
      // exits 0 without a handshake → zero-code classification. The worker
      // must not survive the classification: reapOrphanedProcessGroup kills
      // the group.
      const heartbeat = '/tmp/lobehub-precheck-reap-heartbeat';

      const result = await runPreCheck('node', [
        '-e',
        [
          `require("node:fs").rmSync("${heartbeat}", { force: true });`,
          'const { spawn } = require("node:child_process");',
          `const w = spawn(process.execPath, ["-e", "const fs=require(\\"fs\\");const t=setInterval(()=>fs.appendFileSync(\\"${heartbeat}\\", String(Date.now())+\\"\\\\n\\"),200);"], { stdio: "ignore" });`,
          'w.unref();',
          'setTimeout(() => process.exit(0), 700);', // worker writes ~3 lines first
        ].join(' '),
      ]);

      expect(result.success).toBe(false);
      expect(result.diagnosis).toContain('without completing the MCP handshake');

      const settleWait = Date.now() + 5000;
      let lines = 0;
      while (Date.now() < settleWait) {
        await new Promise((r) => setTimeout(r, 400));
        lines = require('node:fs').existsSync(heartbeat)
          ? require('node:fs').readFileSync(heartbeat, 'utf8').trim().split('\n').length
          : 0;
        if (lines >= 3) break;
      }
      const stableAt = lines;

      await new Promise((r) => setTimeout(r, 1600));
      const finalLines = require('node:fs').existsSync(heartbeat)
        ? require('node:fs').readFileSync(heartbeat, 'utf8').trim().split('\n').length
        : 0;

      expect(stableAt).toBeGreaterThanOrEqual(3);
      expect(finalLines).toBe(stableAt);
    },
  );

  it('reports a nonzero exit with its code after streams drain', { timeout: 15_000 }, async () => {
    const result = await runPreCheck('node', [
      '-e',
      'process.stderr.write("boom\\n"); process.exit(3)',
    ]);

    expect(result.success).toBe(false);
    expect(result.diagnosis).toContain('code 3');
  });
});

describe('MCPClient.initialize respawn gating (P2 4306033474)', () => {
  /**
   * Drive `initialize()` against a stubbed SDK client to prove the
   * diagnostic re-spawn only fires for the SDK ConnectionClosed
   * failure it was built to diagnose.
   */
  const runInitialize = async (connectError: unknown): Promise<{ respawned: boolean }> => {
    let respawned = false;
    const probe = MCPClient.prototype as unknown as {
      initialize: MCPClient['initialize'];
    };

    const instance = Object.create(MCPClient.prototype) as MCPClient;
    // Stub the private fields initialize() reads.
    Object.assign(instance, {
      isStdio: true,
      stderrLogs: [],
      stdioParams: { args: [], command: 'irrelevant' },
      mcp: {
        connect: () => {
          throw connectError;
        },
      },
      // Instrument the private pre-check instead of spawning real processes.
      preCheckStdioCommand: async () => {
        respawned = true;
        return { diagnosis: 'stubbed', stderr: '', stdout: '', success: false };
      },
    });

    try {
      await probe.initialize.call(instance, {});
    } catch {
      // initialize() is expected to throw — the call shape is not under test.
    }
    return { respawned };
  };

  it('re-spawns for the SDK ConnectionClosed failure', async () => {
    const { respawned } = await runInitialize(
      new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'),
    );

    expect(respawned).toBe(true);
  });

  it('does not re-spawn for other handshake failures (protocol/config errors)', async () => {
    const { respawned } = await runInitialize(
      new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Invalid params — incompatible protocol version',
      ),
    );

    expect(respawned).toBe(false);
  });
});
