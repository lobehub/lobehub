// @vitest-environment node
// Regression cases reproduced from agent vent reports about modifyNodes / createDocument.
// Each case asserts the expected behaviour against the production headless editor path.
import { describe, expect, it } from 'vitest';

import type { AgentDocumentLiteXMLOperation } from './headlessEditor';
import {
  applyLiteXMLOperations,
  createAgentMarkdownSnapshot,
  createMarkdownEditorSnapshot,
  exportEditorDataSnapshot,
} from './headlessEditor';

const load = async (md: string) => {
  const s = await createMarkdownEditorSnapshot(md);
  return exportEditorDataSnapshot({
    editorData: s.editorData,
    fallbackContent: s.content,
    litexml: true,
  });
};

// Simulates the agent's read-back: persisted editorData re-hydrated by readDocument.
const editThenRead = async (
  base: Awaited<ReturnType<typeof load>>,
  operations: AgentDocumentLiteXMLOperation[],
) => {
  const r = await applyLiteXMLOperations({
    editorData: base.editorData,
    fallbackContent: base.content,
    operations,
  });
  return exportEditorDataSnapshot({
    editorData: r.editorData,
    fallbackContent: r.content,
    litexml: true,
  });
};

const liId = (xml: string, text: string) =>
  xml.match(new RegExp(`<li id="(\\w+)">\\s*<span id="\\w+">${text}</span>`))![1];
const blockId = (xml: string, tag: string, text: string) =>
  xml.match(new RegExp(`<${tag} id="(\\w+)">\\s*<span id="\\w+">${text}</span>`))![1];

const LIST = '# T\n\nintro\n\n- a\n- b\n  - b1\n  - b2\n- c\n\n## After\n\ntail\n';

describe('agent document modifyNodes regressions', () => {
  it('R1 insert <li> afterId keeps its children (listItemAdd diff is exported empty)', async () => {
    const base = await load(LIST);
    const back = await editThenRead(base, [
      { action: 'insert', afterId: liId(base.litexml!, 'a'), litexml: '<li><span>NEW</span></li>' },
    ]);
    expect(back.content).toContain('- NEW');
  });

  it('R2 insert <li> beforeId does not destroy siblings or duplicate the tail', async () => {
    const base = await load(LIST);
    const back = await editThenRead(base, [
      {
        action: 'insert',
        beforeId: liId(base.litexml!, 'c'),
        litexml: '<li><span>NEW</span></li>',
      },
    ]);
    expect(back.content).toContain('- c');
    expect(back.content.match(/## After/g)).toHaveLength(1);
  });

  it('R3 remove <li> actually removes the item (listItemRemove leaves an empty shell)', async () => {
    const base = await load(LIST);
    const back = await editThenRead(base, [{ action: 'remove', id: liId(base.litexml!, 'a') }]);
    expect(back.content).not.toMatch(/^-\s*$/m);
  });

  it('R4 multiple inserts with the same beforeId keep array order', async () => {
    const base = await load(LIST);
    const anchor = blockId(base.litexml!, 'p', 'tail');
    const back = await editThenRead(
      base,
      ['P1', 'P2', 'P3'].map((t) => ({
        action: 'insert' as const,
        beforeId: anchor,
        litexml: `<p><span>${t}</span></p>`,
      })),
    );
    expect(back.content.indexOf('P1')).toBeLessThan(back.content.indexOf('P3'));
  });

  it('R4b multiple inserts with the same afterId keep array order', async () => {
    const base = await load(LIST);
    const anchor = blockId(base.litexml!, 'p', 'intro');
    const back = await editThenRead(
      base,
      ['P1', 'P2', 'P3'].map((t) => ({
        action: 'insert' as const,
        afterId: anchor,
        litexml: `<p><span>${t}</span></p>`,
      })),
    );
    expect(back.content).toContain('intro\n\nP1\n\nP2\n\nP3\n\n- a');
  });

  it('R5 a stale/unknown id inside a batch is reported, not silently skipped', async () => {
    const base = await load(LIST);
    await expect(
      applyLiteXMLOperations({
        editorData: base.editorData,
        fallbackContent: base.content,
        operations: [
          { action: 'modify', litexml: '<span id="zzzz">stale</span>' },
          {
            action: 'insert',
            afterId: blockId(base.litexml!, 'p', 'tail'),
            litexml: '<p><span>ok</span></p>',
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it('R6 CLI-written editorData {type:"doc",content}: an id returned by readDocument is still valid for modifyNodes', async () => {
    const md = '## Tick Log\n\n- tick 1\n';
    const editorData = { content: md, type: 'doc' }; // shape older `lh doc` builds persisted
    const read = await exportEditorDataSnapshot({ editorData, fallbackContent: md, litexml: true });
    // readDocument persists a recovered snapshot before exposing its ids, so the
    // next edit must hydrate that persisted state instead of re-parsing Markdown.
    expect(read.recoveredFromMarkdown).toBe(true);
    const h2 = read.litexml!.match(/<h2 id="(\w+)">/)![1];
    const r = await applyLiteXMLOperations({
      editorData: read.editorData,
      fallbackContent: read.content,
      operations: [{ action: 'insert', afterId: h2, litexml: '<p><span>NEW TICK</span></p>' }],
    });
    expect(r.content).toContain('NEW TICK');
  });

  it('R7 modifying the same <li> container twice keeps list structure', async () => {
    const base = await load('# T\n\n- one\n- two\n- three\n');
    const id = liId(base.litexml!, 'two');
    const once = await editThenRead(base, [
      { action: 'modify', litexml: `<li id="${id}"><span>two v2</span></li>` },
    ]);
    expect(once.content).toContain('- two v2\n');

    const twice = await editThenRead(once, [
      {
        action: 'modify',
        litexml: `<li id="${liId(once.litexml!, 'two v2')}"><span>two v3</span></li>`,
      },
    ]);
    expect(twice.content).toBe('# T\n\n- one\n- two v3\n- three\n');
  });

  // Upstream @lobehub/editor re-parses a modified node without keeping its key,
  // so the id changes after every modify. A stale id in a later batch is now
  // rejected loudly (R5); keeping the id needs the editor dependency to change.
  it.fails('R7b modifying a <li> keeps its id', async () => {
    const base = await load('# T\n\n- one\n- two\n- three\n');
    const id = liId(base.litexml!, 'two');
    const once = await editThenRead(base, [
      { action: 'modify', litexml: `<li id="${id}"><span>two v2</span></li>` },
    ]);
    expect(once.litexml).toContain(`id="${id}"`);
  });

  it('R8 modify of a whole <ul> keeps its items', async () => {
    const base = await load(LIST);
    const ul = base.litexml!.match(/<ul id="(\w+)">/)![1];
    const back = await editThenRead(base, [
      {
        action: 'modify',
        litexml: `<ul id="${ul}"><li><span>L1</span></li><li><span>L2</span></li></ul>`,
      },
    ]);
    expect(back.content).toContain('- L1');
  });

  it('R9 an inserted <ul> is not serialized as a fenced code block', async () => {
    const base = await load(LIST);
    const back = await editThenRead(base, [
      {
        action: 'insert',
        afterId: blockId(base.litexml!, 'p', 'intro'),
        litexml: '<h3>Sub</h3><ul><li><span>u1</span></li></ul>',
      },
    ]);
    expect(back.content).not.toContain('```');
  });
});

describe('agent document markdown writes regressions', () => {
  it('R10 LiteXML passed as markdown content must not silently become an empty document', async () => {
    await expect(
      createAgentMarkdownSnapshot(
        '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <p id="a"><span id="b">Body</span></p>\n</root>',
      ),
    ).rejects.toThrow(/LiteXML/);
  });

  // Upstream @lobehub/editor markdown writer bug (table cell text ending in a
  // backslash escapes the column separator). Kept as an expected failure so it
  // flips to a hard failure once the editor dependency fixes it.
  it.fails('R11 table cell text ending in a backslash keeps the column count', async () => {
    const base = await load('| a | b | c |\n| --- | --- | --- |\n| x | y | z |\n');
    const span = base.litexml!.match(/<span id="(\w+)">y<\/span>/)![1];
    const back = await editThenRead(base, [
      { action: 'modify', litexml: `<span id="${span}">D:\\lobechat\\{id}_search\\</span>` },
    ]);
    const header = back.content.split('\n')[0];
    expect(header.split('|').length - 2).toBe(3);
  });
});
