import { describe, expect, it, vi } from 'vitest';

import type { CodeEditorIO } from './browserCodeEditor';
import { applyCodeEdit, fillCodeEditor, formatCodeEditors } from './browserCodeEditor';

const TARGET = 'document.activeElement';

/** An editor reached through its API, with `doc` as the model. */
const apiEditor = (initial: string, probe: Record<string, unknown> = {}) => {
  const page = { doc: initial, writes: 0 };
  const evaluate = vi.fn(async (script: string) => {
    if (script.includes('executeEdits')) {
      const [, start, end, text] = script.match(/\}\)\((\d+), (\d+), (".*")\)$/s)!;
      page.doc = page.doc.slice(0, +start) + JSON.parse(text) + page.doc.slice(+end);
      page.writes += 1;
      return JSON.stringify({ ok: true });
    }
    if (script.includes('text: bound ?')) return JSON.stringify({ text: page.doc });
    return JSON.stringify({ hasApi: true, isEditor: true, readOnly: false, ...probe });
  });
  const io: CodeEditorIO = { evaluate, selectAll: vi.fn(), sleep: async () => {} };
  return { io, page };
};

/** An editor that hides its API, so it is read and written with clipboard events. */
const keyboardEditor = (initial: string, { garblesPaste = false, selects = true } = {}) => {
  const page = { doc: initial, pastes: 0 };
  const evaluate = vi.fn(async (script: string) => {
    if (script.includes("ClipboardEvent('copy'")) {
      return JSON.stringify({ empty: page.doc === '', selected: selects, text: page.doc });
    }
    if (script.includes("ClipboardEvent('paste'")) {
      page.doc = garblesPaste ? 'garbled' : JSON.parse(script.match(/\}\)\((".*")\)$/s)![1]);
      page.pastes += 1;
      return true;
    }
    return JSON.stringify({ hasApi: false, isEditor: true, readOnly: false });
  });
  const io: CodeEditorIO = { evaluate, selectAll: vi.fn(), sleep: async () => {} };
  return { io, page };
};

describe('applyCodeEdit', () => {
  it('replaces the whole document without oldText', () => {
    expect(applyCodeEdit('a', { text: 'b\r\nc' })).toEqual({ next: 'b\nc' });
  });

  it('replaces a passage that occurs once', () => {
    expect(applyCodeEdit('raw=false;\n', { oldText: 'false', text: 'true' })).toEqual({
      next: 'raw=true;\n',
    });
  });

  it('refuses a passage that is missing, repeated or empty', () => {
    expect(applyCodeEdit('a', { oldText: 'x', text: 'y' })).toMatchObject({
      error: expect.stringContaining('not found'),
    });
    expect(applyCodeEdit('aa', { oldText: 'a', text: 'y' })).toMatchObject({
      error: expect.stringContaining('more than once'),
    });
    expect(applyCodeEdit('a', { oldText: '', text: 'y' })).toMatchObject({
      error: expect.stringContaining('empty'),
    });
  });
});

describe('fillCodeEditor', () => {
  it('leaves an ordinary field to the caller', async () => {
    const io: CodeEditorIO = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ isEditor: false })),
      selectAll: vi.fn(),
    };

    await expect(fillCodeEditor(io, TARGET, { text: 'x' })).resolves.toEqual({ handled: false });
  });

  it('writes only the changed range through the API', async () => {
    const { io, page } = apiEditor('const raw=false;\nexport default raw;\n');

    await expect(
      fillCodeEditor(io, TARGET, { oldText: 'raw=false', text: 'raw=true' }),
    ).resolves.toEqual({ handled: true });

    expect(page.doc).toBe('const raw=true;\nexport default raw;\n');
    expect(io.selectAll).not.toHaveBeenCalled();
  });

  it('refuses a read-only editor and submit without writing', async () => {
    const readOnly = apiEditor('a', { readOnly: true });
    await expect(fillCodeEditor(readOnly.io, TARGET, { text: 'b' })).resolves.toMatchObject({
      error: expect.stringContaining('read-only'),
    });
    expect(readOnly.page.writes).toBe(0);

    const submit = apiEditor('a');
    await expect(
      fillCodeEditor(submit.io, TARGET, { submit: true, text: 'b' }),
    ).resolves.toMatchObject({ error: expect.stringContaining('submit') });
    expect(submit.page.writes).toBe(0);
  });

  it('replaces the document through clipboard events when the API is hidden', async () => {
    const { io, page } = keyboardEditor('const raw=false;\n');

    await expect(fillCodeEditor(io, TARGET, { oldText: 'false', text: 'true' })).resolves.toEqual({
      handled: true,
    });

    expect(page.doc).toBe('const raw=true;\n');
    expect(page.pastes).toBe(1);
  });

  // With nothing selected Monaco copies the caret's line, and the paste would
  // insert at the caret instead of replacing the document.
  it('does not paste when select-all did not take', async () => {
    const { io, page } = keyboardEditor('const raw=false;\n', { selects: false });

    await expect(fillCodeEditor(io, TARGET, { text: 'x' })).resolves.toMatchObject({
      error: expect.stringContaining('Nothing changed'),
    });
    expect(page.pastes).toBe(0);
  });

  it('reports an edit that does not read back', async () => {
    const { io } = keyboardEditor('a', { garblesPaste: true });

    await expect(fillCodeEditor(io, TARGET, { text: 'b' })).resolves.toMatchObject({
      error: expect.stringContaining('does not match'),
    });
  });
});

describe('formatCodeEditors', () => {
  it('labels partial and truncated text', () => {
    const block = formatCodeEditors(
      JSON.stringify([{ complete: false, lines: 2, text: 'ab', totalChars: 10 }]),
    );

    expect(block).toContain('visible lines only');
    expect(block).toContain('first 2 of 10 chars');
  });

  it('adds nothing for a page without editors or with bad data', () => {
    expect(formatCodeEditors('[]')).toBe('');
    expect(formatCodeEditors(undefined)).toBe('');
  });
});
