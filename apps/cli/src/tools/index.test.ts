import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ShellProcessManager } from '@lobechat/local-file-shell';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeToolCall } from './index';
import * as isolatedWorker from './isolatedWorker';

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('executeToolCall', () => {
  const tmpDir = path.join(os.tmpdir(), 'cli-tool-dispatch-test-' + process.pid);

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('should dispatch readFile with formatted content and structured state', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, 'hello world');

    const result = await executeToolCall('readFile', JSON.stringify({ path: filePath }));

    expect(result.success).toBe(true);
    // content is now the formatted prompt text, not raw JSON
    expect(result.content).toContain('hello world');
    // structured payload travels in `state` for client renders
    expect((result.state as { content: string }).content).toContain('hello world');
  });

  it('should dispatch writeFile', async () => {
    const filePath = path.join(tmpDir, 'new.txt');

    const result = await executeToolCall(
      'writeFile',
      JSON.stringify({ content: 'written', path: filePath }),
    );

    expect(result.success).toBe(true);
    expect((result.state as { path: string }).path).toBe(filePath);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('written');
  });

  it('should dispatch legacy alias readLocalFile', async () => {
    const filePath = path.join(tmpDir, 'legacy.txt');
    await writeFile(filePath, 'legacy hello');

    const result = await executeToolCall('readLocalFile', JSON.stringify({ path: filePath }));

    expect(result.success).toBe(true);
    expect((result.state as { content: string }).content).toContain('legacy hello');
  });

  it('should dispatch runCommand', async () => {
    const result = await executeToolCall(
      'runCommand',
      JSON.stringify({ command: 'echo dispatched' }),
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('dispatched');
    const state = result.state as { stdout?: string };
    expect(state.stdout).toContain('dispatched');
  });

  it('should dispatch listFiles', async () => {
    const workerResult = { content: 'list result', state: { totalCount: 1 }, success: true };
    const spy = vi
      .spyOn(isolatedWorker, 'executeToolCallInWorker')
      .mockResolvedValueOnce(workerResult);

    const result = await executeToolCall('listFiles', JSON.stringify({ path: tmpDir }));

    expect(result).toEqual(workerResult);
    expect(spy).toHaveBeenCalledWith('listFiles', JSON.stringify({ path: tmpDir }), undefined);
  });

  it('should dispatch globFiles', async () => {
    const workerResult = { content: 'glob result', state: { files: ['test.ts'] }, success: true };
    const spy = vi
      .spyOn(isolatedWorker, 'executeToolCallInWorker')
      .mockResolvedValueOnce(workerResult);

    const result = await executeToolCall(
      'globFiles',
      JSON.stringify({ cwd: tmpDir, pattern: '*.ts' }),
    );

    expect(result).toEqual(workerResult);
    expect(spy).toHaveBeenCalledWith(
      'globFiles',
      JSON.stringify({ cwd: tmpDir, pattern: '*.ts' }),
      undefined,
    );
  });

  it('should dispatch editFile', async () => {
    const filePath = path.join(tmpDir, 'edit.txt');
    await writeFile(filePath, 'old content');

    const result = await executeToolCall(
      'editFile',
      JSON.stringify({
        file_path: filePath,
        new_string: 'new content',
        old_string: 'old content',
      }),
    );

    expect(result.success).toBe(true);
    expect((result.state as { replacements: number }).replacements).toBeGreaterThan(0);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
  });

  it('should return error for unknown API', async () => {
    const result = await executeToolCall('unknownApi', '{}');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool API');
  });

  it('should carry structured state on file reads', async () => {
    const filePath = path.join(tmpDir, 'str.txt');
    await writeFile(filePath, 'content');

    const result = await executeToolCall('readFile', JSON.stringify({ path: filePath }));

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
    expect(typeof result.content).toBe('string');
  });

  it('should return error for invalid JSON arguments', async () => {
    const result = await executeToolCall('readFile', 'not-json');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should dispatch grepContent', async () => {
    const pattern = `findme-${process.pid}`;
    await writeFile(path.join(tmpDir, 'grep.txt'), `${pattern} here`);

    vi.stubEnv('LOBEHUB_CLI_TOOL_WORKER', '1');
    const result = await executeToolCall(
      'grepContent',
      // Use the manifest-facing `scope` field. `directory` is a runtime-only
      // normalized shape and would hide scope->cwd forwarding regressions.
      JSON.stringify({ glob: '*.txt', output_mode: 'files_with_matches', pattern, scope: tmpDir }),
    );

    expect(result.success).toBe(true);
    expect((result.state as { totalMatches: number }).totalMatches).toBe(1);
  });

  it('should dispatch searchFiles', async () => {
    const workerResult = {
      content: 'search result',
      state: { results: [{ path: path.join(tmpDir, 'search_target.txt') }] },
      success: true,
    };
    const spy = vi
      .spyOn(isolatedWorker, 'executeToolCallInWorker')
      .mockResolvedValueOnce(workerResult);

    const result = await executeToolCall(
      'searchFiles',
      JSON.stringify({ directory: tmpDir, keywords: 'search_target' }),
    );

    expect(result).toEqual(workerResult);
    expect(spy).toHaveBeenCalledWith(
      'searchFiles',
      JSON.stringify({ directory: tmpDir, keywords: 'search_target' }),
      undefined,
    );
  });

  it('should dispatch getCommandOutput', async () => {
    const result = await executeToolCall(
      'getCommandOutput',
      JSON.stringify({ shell_id: 'nonexistent' }),
    );

    // The runtime envelopes a failed lookup as success:true with the failure in state
    expect(result.success).toBe(true);
    expect((result.state as { success: boolean }).success).toBe(false);
  });

  it('should forward the gateway timeout to getCommandOutput polling', async () => {
    const spy = vi
      .spyOn(ShellProcessManager.prototype, 'getOutput')
      .mockResolvedValue({ exit_code: 0, output: '', stderr: '', stdout: '', success: true });

    // 3rd arg is the gateway per-call timeout; executeToolCall injects it into args
    await executeToolCall('getCommandOutput', JSON.stringify({ shell_id: 'sid' }), 5000);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ shell_id: 'sid', timeout: 5000 }));
    spy.mockRestore();
  });

  it('should dispatch killCommand', async () => {
    const result = await executeToolCall(
      'killCommand',
      JSON.stringify({ shell_id: 'nonexistent' }),
    );

    expect(result.success).toBe(true);
    expect((result.state as { success: boolean }).success).toBe(false);
  });
});
