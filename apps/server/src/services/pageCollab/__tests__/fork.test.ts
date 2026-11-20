// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createDocumentHeadlessEditor } from '@/server/services/agentDocuments/headlessEditor';

import { openPageFork, projectPageState } from '../fork';

const editorDataOf = (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const { editorData } = editor.export();
  editor.destroy();
  return editorData;
};

// The list items of a page's first block, as the stored editor JSON holds them.
const listItemStates = (editorData: unknown) =>
  ((editorData as any).root.children[0].children as any[]).map(
    ({ $: { listHeading, listNumber } = {} as any }) => ({ listHeading, listNumber }),
  );

const idOf = (litexml: string, text: string) =>
  litexml.match(new RegExp(`<p id="(\\w+)">\\s*<span[^>]*>${text}`))?.[1];

describe('openPageFork', () => {
  it('bootstraps a room state once from editorData', async () => {
    const fork = await openPageFork(undefined, editorDataOf('# Title\n\npara one\n'));
    const state = fork.diff();
    fork.destroy();

    expect((await projectPageState(state)).markdown).toBe('# Title\n\npara one\n');
  });

  it('produces an incremental update that merges with concurrent edits', async () => {
    const seed = await openPageFork(undefined, editorDataOf('para one\n\npara two\n'));
    const room = new Y.Doc();
    Y.applyUpdate(room, seed.diff());
    seed.destroy();

    const agent = await openPageFork(Y.encodeStateAsUpdate(room));
    const user = await openPageFork(Y.encodeStateAsUpdate(room));

    const agentXml = agent.editor.export({ litexml: true }).litexml!;
    await agent.editor.applyLiteXML({
      action: 'replace',
      litexml: `<p id="${idOf(agentXml, 'para two')}">para TWO</p>`,
    } as any);
    const userXml = user.editor.export({ litexml: true }).litexml!;
    await user.editor.applyLiteXML({
      action: 'replace',
      litexml: `<p id="${idOf(userXml, 'para one')}">para ONE</p>`,
    } as any);

    Y.applyUpdate(room, agent.diff());
    Y.applyUpdate(room, user.diff());
    agent.destroy();
    user.destroy();

    expect((await projectPageState(Y.encodeStateAsUpdate(room))).markdown).toBe(
      'para ONE\n\npara TWO\n',
    );
  });

  it('derives the same stable ids in separate forks', async () => {
    const seed = await openPageFork(undefined, editorDataOf('para one\n\npara two\n'));
    const state = seed.diff();
    seed.destroy();

    const a = await openPageFork(state);
    const b = await openPageFork(state);
    const values = (fork: typeof a) => [...fork.stableIds().values()].sort();

    expect(values(a)).toEqual(values(b));
    expect(values(a).length).toBeGreaterThan(0);
    a.destroy();
    b.destroy();
  });

  it('joins a room whose page holds an image block', async () => {
    const seed = await openPageFork(
      undefined,
      editorDataOf('para one\n\n![icon](https://example.com/icon.png)\n\npara two\n'),
    );
    const state = seed.diff();
    seed.destroy();

    const projected = await projectPageState(state);

    expect(projected.markdown).toContain('para two');
    expect(projected.markdown).toContain('https://example.com/icon.png');
  });

  it('seeds a room with heading list items and numbering restarts, and projects them back', async () => {
    const source = createDocumentHeadlessEditor();
    source.hydrateMarkdown('1. ## Overview\n2. Details\n3. More\n', { keepId: true });
    const editorData = source.export().editorData as any;
    source.destroy();
    // The page editor stores a restart on the item it was set on.
    editorData.root.children[0].children[2].$.listNumber = 7;

    const seed = await openPageFork(undefined, editorData);
    const state = seed.diff();
    seed.destroy();

    const projected = await projectPageState(state);

    expect(listItemStates(projected.editorData)).toEqual([
      { listHeading: 'h2', listNumber: undefined },
      { listHeading: undefined, listNumber: undefined },
      { listHeading: undefined, listNumber: 7 },
    ]);
    expect(projected.markdown).toContain('1. ## Overview\n');
  });
});
