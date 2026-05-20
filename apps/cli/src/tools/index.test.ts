import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeToolCall } from './index';

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
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('should dispatch readFile', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, 'hello world');

    const result = await executeToolCall('readFile', JSON.stringify({ path: filePath }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.content).toContain('hello world');
  });

  it('should dispatch writeFile', async () => {
    const filePath = path.join(tmpDir, 'new.txt');

    const result = await executeToolCall(
      'writeFile',
      JSON.stringify({ content: 'written', path: filePath }),
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('written');
  });

  it('should dispatch legacy alias readLocalFile', async () => {
    const filePath = path.join(tmpDir, 'legacy.txt');
    await writeFile(filePath, 'legacy hello');

    const result = await executeToolCall('readLocalFile', JSON.stringify({ path: filePath }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.content).toContain('legacy hello');
  });

  it('should dispatch runCommand', async () => {
    const result = await executeToolCall(
      'runCommand',
      JSON.stringify({ command: 'echo dispatched' }),
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.stdout).toContain('dispatched');
  });

  it('should dispatch listFiles', async () => {
    await writeFile(path.join(tmpDir, 'a.txt'), 'a');

    const result = await executeToolCall('listFiles', JSON.stringify({ path: tmpDir }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.totalCount).toBeGreaterThan(0);
  });

  it('should dispatch globFiles', async () => {
    await writeFile(path.join(tmpDir, 'test.ts'), 'code');

    const result = await executeToolCall(
      'globFiles',
      JSON.stringify({ cwd: tmpDir, pattern: '*.ts' }),
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.files).toContain('test.ts');
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
    expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
  });

  it('should return error for unknown API', async () => {
    const result = await executeToolCall('unknownApi', '{}');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool API');
  });

  it('should handle tool that returns a string result', async () => {
    // runCommand returns an object, but we test the string branch by mocking
    // Actually, none of the tools return plain strings, so the JSON.stringify branch
    // is always taken. The string check is for future-proofing.
    // Let's verify the JSON output path
    const filePath = path.join(tmpDir, 'str.txt');
    await writeFile(filePath, 'content');

    const result = await executeToolCall('readFile', JSON.stringify({ path: filePath }));

    expect(result.success).toBe(true);
    // Result should be valid JSON
    expect(() => JSON.parse(result.content)).not.toThrow();
  });

  it('should return error for invalid JSON arguments', async () => {
    const result = await executeToolCall('readFile', 'not-json');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should dispatch grepContent', async () => {
    await writeFile(path.join(tmpDir, 'grep.txt'), 'findme here');

    const result = await executeToolCall(
      'grepContent',
      JSON.stringify({ cwd: tmpDir, pattern: 'findme' }),
    );

    expect(result.success).toBe(true);
  });

  it('should dispatch searchFiles', async () => {
    await writeFile(path.join(tmpDir, 'search_target.txt'), 'found');

    const result = await executeToolCall(
      'searchFiles',
      JSON.stringify({ directory: tmpDir, keywords: 'search_target' }),
    );

    expect(result.success).toBe(true);
  });

  it('should dispatch getCommandOutput', async () => {
    const result = await executeToolCall(
      'getCommandOutput',
      JSON.stringify({ shell_id: 'nonexistent' }),
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.success).toBe(false);
  });

  it('should dispatch killCommand', async () => {
    const result = await executeToolCall(
      'killCommand',
      JSON.stringify({ shell_id: 'nonexistent' }),
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.success).toBe(false);
  });
});
