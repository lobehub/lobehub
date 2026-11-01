import { describe, expect, it } from 'vitest';

import { applyCanvasChanges, collectCanvasFileRefs } from './changes';

const base = new Map([
  ['index.html', { content: '<h1>Old title</h1><p>body</p>', path: 'index.html' }],
  ['data.json', { content: '[1]', path: 'data.json' }],
]);

const textOf = (result: ReturnType<typeof applyCanvasChanges>, path: string) => {
  if (!result.ok) throw new Error(result.error);
  return result.files.find((file) => file.path === path)?.content;
};

describe('applyCanvasChanges', () => {
  it('writes, replaces and deletes files in one change set', () => {
    const result = applyCanvasChanges(base, {
      deletes: ['data.json'],
      edits: [{ newText: 'New title', oldText: 'Old title', path: 'index.html' }],
      writes: [{ content: 'body{}', path: './css/app.css' }],
    });

    expect(result.ok).toBe(true);
    expect(textOf(result, 'index.html')).toBe('<h1>New title</h1><p>body</p>');
    expect(textOf(result, 'css/app.css')).toBe('body{}');
    expect(textOf(result, 'data.json')).toBeUndefined();
  });

  it('decodes base64 writes into bytes', () => {
    const result = applyCanvasChanges(new Map(), {
      writes: [{ content: 'AQID', encoding: 'base64', path: 'a.png' }],
    });

    expect(textOf(result, 'a.png')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects an edit whose old text is missing or ambiguous', () => {
    expect(
      applyCanvasChanges(base, { edits: [{ newText: 'x', oldText: 'nope', path: 'index.html' }] }),
    ).toMatchObject({ ok: false });
    expect(
      applyCanvasChanges(new Map([['a.html', { content: 'aa', path: 'a.html' }]]), {
        edits: [{ newText: 'b', oldText: 'a', path: 'a.html' }],
      }),
    ).toMatchObject({ error: expect.stringContaining('2 times'), ok: false });
  });

  it('rejects edits and deletes of files that do not exist', () => {
    expect(applyCanvasChanges(base, { deletes: ['nope.css'] })).toMatchObject({ ok: false });
    expect(
      applyCanvasChanges(base, { edits: [{ newText: 'b', oldText: 'a', path: 'nope.html' }] }),
    ).toMatchObject({ ok: false });
  });

  it('rejects edits of binary files', () => {
    const binary = new Map([['a.png', { content: new Uint8Array([1]), path: 'a.png' }]]);
    expect(
      applyCanvasChanges(binary, { edits: [{ newText: 'b', oldText: 'a', path: 'a.png' }] }),
    ).toMatchObject({ ok: false });
  });

  // Regression: a model that omits `path` used to crash inside normalizeCanvasPath with
  // `Cannot read properties of undefined (reading 'replaceAll')` instead of a usable error.
  it('names the missing field when an edit has no path', () => {
    const result = applyCanvasChanges(base, {
      edits: [{ newText: 'New title', oldText: 'Old title' } as any],
    });

    expect(result).toEqual({
      error: 'edits[0] is missing "path": every edit must name the file it targets, e.g. "index.html".',
      ok: false,
    });
  });

  it('names the missing field when a later edit in the list has no path', () => {
    const result = applyCanvasChanges(base, {
      edits: [
        { newText: 'New title', oldText: 'Old title', path: 'index.html' },
        { newText: 'x', oldText: 'y', path: '' } as any,
      ],
    });

    expect(result).toMatchObject({ error: expect.stringContaining('edits[1] is missing "path"') });
  });

  it('names the missing field when an edit has no oldText or newText', () => {
    expect(
      applyCanvasChanges(base, { edits: [{ oldText: 'Old title', path: 'index.html' } as any] }),
    ).toMatchObject({ error: expect.stringContaining('"oldText" and "newText"') });
    expect(
      applyCanvasChanges(base, { edits: [{ newText: 'x', path: 'index.html' } as any] }),
    ).toMatchObject({ error: expect.stringContaining('"oldText" and "newText"') });
  });

  it('names the missing field when a write has no path', () => {
    expect(applyCanvasChanges(base, { writes: [{ content: 'body{}' } as any] })).toEqual({
      error: 'writes[0] is missing "path": every write must name the file it targets, e.g. "index.html".',
      ok: false,
    });
  });

  it('rejects a delete entry that is not a file path', () => {
    expect(applyCanvasChanges(base, { deletes: [null as any] })).toEqual({
      error: 'deletes[0] must be a file path, e.g. "index.html".',
      ok: false,
    });
  });

  it('fills fileRef writes from the resolved contents', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = applyCanvasChanges(
      new Map(),
      { writes: [{ fileRef: 'file_logo', path: './img/logo.png' }] },
      new Map([['file_logo', bytes]]),
    );

    expect(textOf(result, 'img/logo.png')).toBe(bytes);
  });

  it('refuses a fileRef write that was not resolved', () => {
    const result = applyCanvasChanges(new Map(), {
      writes: [{ fileRef: 'file_missing', path: 'img/logo.png' }],
    });

    expect(result).toEqual({
      error: '"img/logo.png": fileRef "file_missing" could not be resolved.',
      ok: false,
    });
  });

  it('names the missing path for a fileRef write before the fileRef is resolved', () => {
    // Regression (codex review on #21529): collectCanvasFileRefs runs before applyCanvasChanges,
    // so the missing path must be refused here too instead of crashing in the pre-resolution pass.
    expect(
      applyCanvasChanges(new Map(), { writes: [{ fileRef: 'msg_abc.image_1' } as any] }),
    ).toEqual({
      error:
        'writes[0] is missing "path": every write must name the file it targets, e.g. "index.html".',
      ok: false,
    });
  });
});

describe('collectCanvasFileRefs', () => {
  it('treats an empty fileRef as a plain content write', () => {
    const changes = {
      writes: [{ content: 'body{}', encoding: 'utf8' as const, fileRef: '', path: 'app.css' }],
    };

    expect(collectCanvasFileRefs(changes)).toEqual([]);
    expect(textOf(applyCanvasChanges(new Map(), changes), 'app.css')).toBe('body{}');
  });

  it('lists the fileRef writes with normalized paths', () => {
    expect(
      collectCanvasFileRefs({
        writes: [
          { content: 'body{}', path: 'app.css' },
          { fileRef: 'msg_abc.image_1', path: './img/photo.jpg' },
        ],
      }),
    ).toEqual([{ fileRef: 'msg_abc.image_1', path: 'img/photo.jpg' }]);
  });

  it('skips a fileRef write without a path instead of crashing', () => {
    expect(
      collectCanvasFileRefs({ writes: [{ fileRef: 'msg_abc.image_1' } as any] }),
    ).toEqual([]);
  });
});
