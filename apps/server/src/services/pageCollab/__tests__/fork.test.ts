// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { openPageFork, projectPageState } from '../fork';

const editorDataOf = (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const { editorData } = editor.export();
  editor.destroy();
  return editorData;
};

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
});
