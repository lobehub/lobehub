// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { openPageFork, projectPageState } from '../fork';

const roomOf = async (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const fork = await openPageFork(undefined, editor.export().editorData);
  editor.destroy();
  const state = Y.encodeStateAsUpdate(fork.doc);
  fork.destroy();
  return state;
};

describe('projectPageState', () => {
  it('projects a page with its blocks', async () => {
    const projected = await projectPageState(await roomOf('para one\n\npara two\n'));

    expect(projected.markdown).toBe('para one\n\npara two\n');
    expect(projected.lostBlocks).toBe(false);
  });

  it('projects a page the user cleared', async () => {
    // An emptied editor keeps one empty paragraph.
    const blank = createHeadlessEditor();
    blank.hydrateMarkdown('x', { keepId: true });
    blank.hydrateEditorData(
      {
        root: {
          children: [
            { children: [], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 },
          ],
          direction: null,
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      } as any,
      { keepId: true },
    );
    const fork = await openPageFork(undefined, blank.export().editorData);
    blank.destroy();
    const cleared = Y.encodeStateAsUpdate(fork.doc);
    fork.destroy();

    const projected = await projectPageState(cleared);

    expect(projected.markdown.trim()).toBe('');
    expect(projected.lostBlocks).toBe(false);
  });

  it('flags a room whose blocks the binding could not read', async () => {
    const doc = new Y.Doc();
    const root = doc.get('root', Y.XmlText);
    // A block the editor binding has no node for: the projection exports nothing.
    root.insertEmbed(0, new Y.XmlText(), { __type: 'unknown-block' });

    const projected = await projectPageState(Y.encodeStateAsUpdate(doc));

    expect(projected.lostBlocks).toBe(true);
  });
});
