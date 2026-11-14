import { describe, expect, it, vi } from 'vitest';

import { type SkillRuntimeService, SkillsExecutionRuntime } from './index';

const createRuntime = (exportFile: SkillRuntimeService['exportFile']) =>
  new SkillsExecutionRuntime({
    service: {
      exportFile,
      findAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findById: vi.fn().mockResolvedValue(undefined),
      findByName: vi.fn().mockResolvedValue(undefined),
      readResource: vi.fn(),
    },
  });

// The model reads `content` only — `error` is metadata. These pin that a failed
// export tells the model *why*, so it does not conclude the export channel is
// broken after a bare "Failed to export file" (T-13729).
describe('SkillsExecutionRuntime.exportFile', () => {
  it('surfaces the sandbox reason when the file is not found', async () => {
    const message =
      "File not found. Tried paths: ['nope.txt', '/workspace/nope.txt', '/root/nope.txt', '/tmp/nope.txt']";
    const runtime = createRuntime(
      vi.fn().mockResolvedValue({
        error: { kind: 'stop', message, name: 'TOOL_EXECUTION_FAILED' },
        filename: 'nope.txt',
        success: false,
      }),
    );

    const result = await runtime.exportFile({ filename: 'nope.txt', path: 'nope.txt' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('File not found');
    expect(result.content).toContain(message);
    expect(result.content).toContain('realpath');
    expect(result.error).toMatchObject({ message });
  });

  it('surfaces other export failures with their reason', async () => {
    const runtime = createRuntime(
      vi.fn().mockResolvedValue({
        error: { message: 'Upload failed: 403' },
        filename: 'a.csv',
        success: false,
      }),
    );

    const result = await runtime.exportFile({ filename: 'a.csv', path: '/workspace/a.csv' });

    expect(result.content).toContain('Upload failed: 403');
    expect(result.content).not.toContain('File not found');
  });

  it.each(['', '   ', '/workspace/output/', 'a\0b'])(
    'rejects an invalid path %j without calling the sandbox',
    async (path) => {
      const exportFile = vi.fn();
      const runtime = createRuntime(exportFile);

      const result = await runtime.exportFile({ filename: 'x', path });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Invalid path');
      expect(exportFile).not.toHaveBeenCalled();
    },
  );

  it('passes relative and absolute paths through unchanged', async () => {
    const exportFile = vi
      .fn()
      .mockResolvedValue({ filename: 'r.csv', success: true, url: 'https://x/f/file_1' });
    const runtime = createRuntime(exportFile);

    for (const path of ['./output/result.csv', 'output/result.csv', '/workspace/r.csv']) {
      const result = await runtime.exportFile({ filename: 'r.csv', path });
      expect(result.success).toBe(true);
      expect(exportFile).toHaveBeenLastCalledWith(path, 'r.csv');
    }
  });
});
