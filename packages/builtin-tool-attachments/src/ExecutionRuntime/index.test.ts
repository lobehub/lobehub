import { describe, expect, it, vi } from 'vitest';

import { AttachmentsExecutionRuntime } from './index';

const lines = (count: number) => Array.from({ length: count }, (_, i) => `row ${i + 1}`).join('\n');

describe('AttachmentsExecutionRuntime.readAttachment', () => {
  it('returns one window and names the readAttachment call for the next one', async () => {
    const getFileContents = vi
      .fn()
      .mockResolvedValue([{ content: lines(1000), fileId: 'file_1', filename: 'sales.csv' }]);
    const runtime = new AttachmentsExecutionRuntime({ getFileContents });

    const result = await runtime.readAttachment({ fileId: 'file_1', limit: '10', offset: 401 });

    expect(getFileContents).toHaveBeenCalledWith(['file_1'], undefined);
    expect(result.success).toBe(true);
    expect(result.content).toContain('lines="401-410" total_lines="1000"');
    expect(result.content).toContain('row 401\n');
    expect(result.content).toContain(
      'To continue, call readAttachment with fileId="file_1" and offset=411.',
    );
    expect(result.state).toMatchObject({ endLine: 410, startLine: 401, truncated: true });
  });

  it('reports a stored text cut at parse time', async () => {
    const runtime = new AttachmentsExecutionRuntime({
      getFileContents: vi
        .fn()
        .mockResolvedValue([
          { content: 'head', fileId: 'file_1', filename: 'big.txt', originalCharCount: 9000 },
        ]),
    });

    const result = await runtime.readAttachment({ fileId: 'file_1' });

    expect(result.content).toContain('original_chars="9000"');
    expect(result.content).toContain('The stored text is incomplete');
  });

  it('fails without leaking content when the file cannot be read', async () => {
    const runtime = new AttachmentsExecutionRuntime({
      getFileContents: vi
        .fn()
        .mockResolvedValue([
          { content: '', error: 'File not found', fileId: 'file_x', filename: '' },
        ]),
    });

    const result = await runtime.readAttachment({ fileId: 'file_x' });

    expect(result).toMatchObject({
      content: '<file id="file_x" error="File not found" />',
      success: false,
    });
  });

  it('requires a fileId', async () => {
    const getFileContents = vi.fn();
    const runtime = new AttachmentsExecutionRuntime({ getFileContents });

    expect(await runtime.readAttachment({ fileId: '' })).toMatchObject({ success: false });
    expect(getFileContents).not.toHaveBeenCalled();
  });
});
