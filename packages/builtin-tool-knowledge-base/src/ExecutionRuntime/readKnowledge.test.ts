import { describe, expect, it, vi } from 'vitest';

import { KnowledgeBaseExecutionRuntime } from './index';

const buildLines = (tag: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${tag} ${i + 1}`).join('\n');

const createRuntime = (files: Record<string, { content: string; error?: string }>) => {
  const ragService = {
    getFileContents: vi.fn(async (ids: string[]) =>
      ids.map((id) => {
        const file = files[id];
        const lines = file.content.split('\n');
        return {
          content: file.content,
          error: file.error,
          fileId: id,
          filename: `${id}.md`,
          preview: lines.slice(0, 5).join('\n'),
          totalCharCount: file.content.length,
          totalLineCount: lines.length,
        };
      }),
    ),
    semanticSearchForChat: vi.fn(),
  };

  return { ragService, runtime: new KnowledgeBaseExecutionRuntime(ragService) };
};

describe('KnowledgeBaseExecutionRuntime.readKnowledge', () => {
  it('returns a bounded window per file and reports the range in state', async () => {
    const { runtime } = createRuntime({
      big: { content: buildLines('L', 1000) },
      small: { content: 'only line' },
    });

    const result = await runtime.readKnowledge({ fileIds: ['big', 'small'] });

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      '<file id="big" name="big.md" lines="1-400" totalLines="1000"',
    );
    expect(result.content).toContain('Call readKnowledge again with offset=401 to continue.');
    expect(result.content).toContain('<file id="small" name="small.md" lines="1-1" totalLines="1"');
    expect(result.content).not.toContain('L 401\n');

    const state = result.state as any;
    expect(state.files[0]).toMatchObject({
      endLine: 400,
      fileId: 'big',
      startLine: 1,
      totalCharCount: buildLines('L', 1000).length,
      totalLineCount: 1000,
      truncated: true,
    });
    expect(state.files[1]).toMatchObject({ endLine: 1, startLine: 1, truncated: false });
  });

  it('passes offset and limit through and previews the returned window', async () => {
    const { runtime } = createRuntime({ big: { content: buildLines('L', 1000) } });

    const result = await runtime.readKnowledge({ fileIds: ['big'], limit: 3, offset: 401 });

    expect(result.content).toContain('lines="401-403"');
    expect(result.content).toContain('offset=404 to continue');
    const state = result.state as any;
    expect(state.files[0].preview).toBe('L 401\nL 402\nL 403');
    expect(state.files[0]).toMatchObject({ endLine: 403, startLine: 401, truncated: true });
  });

  it('keeps error files as errors without a window', async () => {
    const { runtime } = createRuntime({
      missing: { content: '', error: 'Document not found' },
    });

    const result = await runtime.readKnowledge({ fileIds: ['missing'] });

    expect(result.content).toContain('error="Document not found"');
    const state = result.state as any;
    expect(state.files[0]).toMatchObject({ error: 'Document not found', fileId: 'missing' });
    expect(state.files[0].startLine).toBeUndefined();
    expect(state.files[0].truncated).toBeUndefined();
  });

  it('rejects an empty fileIds list', async () => {
    const { ragService, runtime } = createRuntime({});

    const result = await runtime.readKnowledge({ fileIds: [] });

    expect(result.success).toBe(false);
    expect(ragService.getFileContents).not.toHaveBeenCalled();
  });
});
