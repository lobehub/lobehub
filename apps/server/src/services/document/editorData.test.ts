// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isValidEditorData } from '@/libs/editor/isValidEditorData';

import { applyLiteXMLOperations, exportEditorDataSnapshot } from '../agentDocuments/headlessEditor';
import { resolveDocumentEditorData } from './editorData';

describe('resolveDocumentEditorData', () => {
  it('keeps valid Lexical editorData untouched', async () => {
    const editorData = { root: { children: [{ type: 'paragraph' }], type: 'root' } };

    await expect(resolveDocumentEditorData({ content: 'x', editorData })).resolves.toBe(editorData);
  });

  it('replaces the `{ type: "doc", content }` shape older CLI builds sent', async () => {
    const content = '## Tick Log\n\n- tick 1\n';
    const editorData = await resolveDocumentEditorData({
      content,
      editorData: { content, type: 'doc' },
    });

    expect(isValidEditorData(editorData)).toBe(true);
  });

  it('builds editorData when only content is sent, so node ids stay stable across reads', async () => {
    const content = '## Tick Log\n\n- tick 1\n';
    const editorData = await resolveDocumentEditorData({ content });

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
    await expect(
      resolveDocumentEditorData({ content: '', fileType: 'custom/folder' }),
    ).resolves.toBeUndefined();
    await expect(resolveDocumentEditorData({})).resolves.toBeUndefined();
  });
});
