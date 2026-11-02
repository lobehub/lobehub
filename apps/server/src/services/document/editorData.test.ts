// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isValidEditorData } from '@/libs/editor/isValidEditorData';

import { applyLiteXMLOperations, exportEditorDataSnapshot } from '../agentDocuments/headlessEditor';
import { resolveDocumentWrite, stripTitleHeading } from './editorData';

describe('resolveDocumentWrite', () => {
  it('keeps valid Lexical editorData untouched', async () => {
    const editorData = { root: { children: [{ type: 'paragraph' }], type: 'root' } };

    const write = await resolveDocumentWrite({ content: 'x', editorData });
    expect(write.editorData).toBe(editorData);
  });

  it('replaces the `{ type: "doc", content }` shape older CLI builds sent', async () => {
    const content = '## Tick Log\n\n- tick 1\n';
    const { editorData } = await resolveDocumentWrite({
      content,
      editorData: { content, type: 'doc' },
    });

    expect(isValidEditorData(editorData)).toBe(true);
  });

  it('builds editorData when only content is sent, so node ids stay stable across reads', async () => {
    const content = '## Tick Log\n\n- tick 1\n';
    const { editorData } = await resolveDocumentWrite({ content });

    const first = await exportEditorDataSnapshot({
      editorData,
      fallbackContent: content,
      litexml: true,
    });
    const second = await exportEditorDataSnapshot({
      editorData,
      fallbackContent: content,
      litexml: true,
    });
    expect(first.litexml).toBe(second.litexml);

    const h2 = first.litexml!.match(/<h2 id="(\w+)">/)![1];
    const edited = await applyLiteXMLOperations({
      editorData,
      fallbackContent: content,
      operations: [{ action: 'insert', afterId: h2, litexml: '<p><span>NEW TICK</span></p>' }],
    });
    expect(edited.content).toContain('NEW TICK');
  });

  it('leaves folders and metadata-only updates alone', async () => {
    await expect(resolveDocumentWrite({ content: '', fileType: 'custom/folder' })).resolves.toEqual(
      { content: '', editorData: undefined },
    );
    await expect(resolveDocumentWrite({})).resolves.toEqual({});
  });

  it('never builds or keeps editorData for an HTML document', async () => {
    const content = '<!doctype html><html><body><h1>Report</h1></body></html>';
    const editorData = { root: { children: [{ type: 'paragraph' }], type: 'root' } };

    await expect(resolveDocumentWrite({ content, fileType: 'custom/html' })).resolves.toEqual({
      content,
      editorData: undefined,
    });
    await expect(
      resolveDocumentWrite({ content, editorData, fileType: 'custom/html', title: 'Report' }),
    ).resolves.toEqual({ content, editorData: undefined });
  });

  it('drops the heading that repeats the title from a Markdown write and its editorData', async () => {
    const write = await resolveDocumentWrite({
      content: '# rc 与 device — 讨论纪要\n\n来源：eval 频道\n',
      title: 'rc 与 device — 讨论纪要',
    });

    expect(write.content).toBe('来源：eval 频道\n');
    const snapshot = await exportEditorDataSnapshot({
      editorData: write.editorData,
      fallbackContent: write.content!,
      litexml: true,
    });
    expect(snapshot.litexml).not.toContain('<h1');
  });

  it('keeps content saved together with editorData as the editor wrote it', async () => {
    const editorData = { root: { children: [{ type: 'paragraph' }], type: 'root' } };
    const content = '# Plan\n\nbody';

    await expect(resolveDocumentWrite({ content, editorData, title: 'Plan' })).resolves.toEqual({
      content,
      editorData,
    });
  });
});

describe('stripTitleHeading', () => {
  it('drops a heading equal to the title, ignoring case, spacing and closing hashes', () => {
    expect(stripTitleHeading('# Weekly  Report #\n\nbody', 'weekly report')).toBe('body');
  });

  it('drops a heading that differs from the title only by a suffix', () => {
    expect(stripTitleHeading('# 任务验证未通过汇总\n\nbody', '任务验证未通过汇总（T-77）')).toBe(
      'body',
    );
    expect(stripTitleHeading('# Report (2026-10-20)\n\nbody', 'Report')).toBe('body');
  });

  it('keeps a heading that names something other than the title', () => {
    const content = '# Background\n\nbody';

    expect(stripTitleHeading(content, 'Launch plan')).toBe(content);
    // A shared prefix that ends mid-word is a different name, not a suffix.
    expect(stripTitleHeading('# Plan\n\nbody', 'Planning notes')).toBe('# Plan\n\nbody');
  });

  it('keeps deeper headings and content without a title', () => {
    expect(stripTitleHeading('## Report\n\nbody', 'Report')).toBe('## Report\n\nbody');
    expect(stripTitleHeading('# Report\n\nbody', undefined)).toBe('# Report\n\nbody');
  });
});
