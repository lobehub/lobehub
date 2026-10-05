import { describe, expect, it } from 'vitest';

import { diffLiteXMLBlocks } from '../liteXMLBlockDiff';

const doc = (...blocks: string[]) => `<root>${blocks.join('')}</root>`;

const ok = (original: string, edited: string) => {
  const result = diffLiteXMLBlocks(original, edited);
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result;
};

const A = '<p id="a">A</p>';
const B = '<p id="b">B</p>';
const C = '<p id="c">C</p>';

describe('diffLiteXMLBlocks', () => {
  it('returns no operations when only formatting whitespace differs', () => {
    const pretty = `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <p id="a">
    <span id="s1">A</span>
  </p>
  <hr id="h"/>
</root>`;
    const compact = '<root><p id="a"><span id="s1">A</span></p><hr id="h"/></root>';

    const result = ok(pretty, compact);

    expect(result.operations).toEqual([]);
    expect(result.summary).toEqual({ inserted: 0, modified: 0, removed: 0 });
  });

  it('modifies a block whose content changed', () => {
    const result = ok(doc(A, B, C), doc(A, '<p id="b">B2</p>', C));

    expect(result.operations).toEqual([{ action: 'modify', litexml: '<p id="b">B2</p>' }]);
    expect(result.summary.modified).toBe(1);
  });

  it('removes a block whose id disappeared', () => {
    const result = ok(doc(A, B, C), doc(A, C));

    expect(result.operations).toEqual([{ action: 'remove', id: 'b' }]);
  });

  it('inserts a new block after the preceding kept block', () => {
    const result = ok(doc(A, B), doc(A, '<p>new</p>', B));

    expect(result.operations).toEqual([{ action: 'insert', afterId: 'a', litexml: '<p>new</p>' }]);
  });

  it('merges consecutive new blocks into one root-wrapped insert', () => {
    const result = ok(doc(A, B), doc(A, B, '<h2>T</h2>', '<p>x</p>'));

    expect(result.operations).toEqual([
      { action: 'insert', afterId: 'b', litexml: '<root><h2>T</h2><p>x</p></root>' },
    ]);
    expect(result.summary.inserted).toBe(2);
  });

  it('anchors leading new blocks before the first kept block', () => {
    const result = ok(doc(A, B), doc('<p>lead</p>', A, B));

    expect(result.operations).toEqual([
      { action: 'insert', beforeId: 'a', litexml: '<p>lead</p>' },
    ]);
  });

  it('anchors a full rewrite after the last original block, then removes the originals', () => {
    const result = ok(doc(A), doc('<p>x</p>', '<p>y</p>'));

    expect(result.operations).toEqual([
      { action: 'insert', afterId: 'a', litexml: '<root><p>x</p><p>y</p></root>' },
      { action: 'remove', id: 'a' },
    ]);
  });

  it('orders operations insert, then modify, then remove, all on original ids', () => {
    const result = ok(doc(A, B, C), doc('<p id="a">A2</p>', '<p>new</p>', C));

    expect(result.operations.map((operation) => operation.action)).toEqual([
      'insert',
      'modify',
      'remove',
    ]);
    expect(result.operations[0]).toEqual({ action: 'insert', afterId: 'a', litexml: '<p>new</p>' });
  });

  it('turns a moved block into remove plus an id-free insert', () => {
    const result = ok(
      doc(A, B, '<p id="c"><span id="cs">C</span></p>'),
      doc(A, '<p id="c"><span id="cs">C</span></p>', B),
    );

    const inserts = result.operations.filter((operation) => operation.action === 'insert');
    const removes = result.operations.filter((operation) => operation.action === 'remove');
    expect(inserts).toHaveLength(1);
    expect(removes).toHaveLength(1);
    expect(JSON.stringify(inserts)).not.toContain('id=');
  });

  it('treats a repeated id after its first use as a new block without ids', () => {
    const result = ok(doc(A, B), doc(A, B, '<p id="b">B copy</p>'));

    expect(result.operations).toEqual([
      { action: 'insert', afterId: 'b', litexml: '<p>B copy</p>' },
    ]);
  });

  it('treats an id missing from the original as new content', () => {
    const result = ok(doc(A, B), doc(A, B, '<p id="zzzz"><span id="yyyy">stale</span></p>'));

    expect(result.operations).toEqual([
      { action: 'insert', afterId: 'b', litexml: '<p><span>stale</span></p>' },
    ]);
  });

  it('keeps a whitespace-only span between formatted runs in the modify payload', () => {
    const original = `<root>
  <p id="p">
    <span id="s1" bold="true">bold</span>
    <span id="s2"> </span>
    <span id="s3">tail</span>
  </p>
</root>`;

    const result = ok(original, original.replace('tail', 'TAIL'));

    expect(result.operations).toEqual([
      {
        action: 'modify',
        litexml:
          '<p id="p"><span id="s1" bold="true">bold</span><span id="s2"><text> </text></span><span id="s3">TAIL</span></p>',
      },
    ]);
  });

  it('keeps inline spaces between tags in newly written blocks', () => {
    const result = ok(doc(A), doc(A, '<p>This is <b>bold</b> <i>ital</i> end</p>'));

    expect(result.operations).toEqual([
      {
        action: 'insert',
        afterId: 'a',
        litexml: '<p>This is <b>bold</b><text> </text><i>ital</i> end</p>',
      },
    ]);
  });

  it('treats unescaped angle brackets inside text and code as text', () => {
    const original = `<root>
  <p id="p">
    <span id="s1">use a</span>
    <span id="s2"><b and c></span>
    <codeInline id="ci">
      <span id="s3"><div></span>
    </codeInline>
  </p>
  <code id="c" lang="html"><p>hi</p>
<p>there</p></code>
  <p id="q">
    <span id="s4">plain</span>
  </p>
</root>`;

    const result = ok(original, original.replace('plain', 'PLAIN').replace('there', 'THERE'));

    expect(result.operations).toEqual([
      {
        action: 'modify',
        litexml: '<code id="c" lang="html">&lt;p&gt;hi&lt;/p&gt;\n&lt;p&gt;THERE&lt;/p&gt;</code>',
      },
      { action: 'modify', litexml: '<p id="q"><span id="s4">PLAIN</span></p>' },
    ]);
  });

  it('strips ids from tags only, not from text that mentions id=', () => {
    const result = ok(doc(A), doc(A, '<p id="zz"><span id="yy">say id="x"</span></p>'));

    expect(result.operations).toEqual([
      { action: 'insert', afterId: 'a', litexml: '<p><span>say id="x"</span></p>' },
    ]);
  });

  it('rejects content written after </root>', () => {
    const result = diffLiteXMLBlocks(doc(A, B), `${doc(A, B)}\n<p>three</p>\n`);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/after <\/root>/);
  });

  it('rejects edits to an empty page and points at the initPage tool', () => {
    const result = diffLiteXMLBlocks('<root></root>', doc('<p>x</p>'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/initPage/);
  });

  it('rejects unbalanced tags', () => {
    const result = diffLiteXMLBlocks(doc(A, B), '<root><p id="a">A</root>');

    expect(result.ok).toBe(false);
  });

  it('rejects a span whose closing tag was cut off instead of swallowing the next block', () => {
    const pretty = (first: string) => `<root>
  <p id="a">
    ${first}
  </p>
  <p id="b">
    <span id="s2">Item 2</span>
  </p>
</root>`;

    const result = diffLiteXMLBlocks(
      pretty('<span id="s1">Item 1</span>'),
      pretty('<span id="s1">Item 1: replaced'),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/span/);
  });

  it('rejects a document without a root element', () => {
    const result = diffLiteXMLBlocks(doc(A, B), `${A}${B}`);

    expect(result.ok).toBe(false);
  });

  it('rejects an edit that strips most ids from a similar-length document', () => {
    const result = diffLiteXMLBlocks(doc(A, B, C), doc('<p>A</p>', '<p>B</p>', '<p>C2</p>'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/id/);
  });
});
