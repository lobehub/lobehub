import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CodeEditorIO } from './browserCodeEditor';
import {
  applyCodeEdit,
  countCodeEditors,
  fillCodeEditor,
  formatCodeEditors,
  readCodeEditorsScript,
} from './browserCodeEditor';

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
  const io: CodeEditorIO = {
    collapseSelection: vi.fn(),
    evaluate,
    selectAll: vi.fn(),
    sleep: async () => {},
  };
  return { io, page };
};

/** An editor that hides its API, so it is read and written with clipboard events. */
const keyboardEditor = (initial: string, { garblesPaste = false, selects = true } = {}) => {
  const page = { doc: initial, pastes: 0, selected: false };
  const evaluate = vi.fn(async (script: string) => {
    if (script.includes("ClipboardEvent('copy'")) {
      return JSON.stringify({ empty: page.doc === '', selected: page.selected, text: page.doc });
    }
    if (script.includes("ClipboardEvent('paste'")) {
      page.doc = garblesPaste ? 'garbled' : JSON.parse(script.match(/\}\)\((".*")\)$/s)![1]);
      page.pastes += 1;
      page.selected = false;
      return true;
    }
    if (script.includes("querySelector('.selected-text');")) return page.selected;
    return JSON.stringify({ hasApi: false, isEditor: true, readOnly: false });
  });
  const io: CodeEditorIO = {
    collapseSelection: vi.fn(async () => {
      page.selected = false;
    }),
    evaluate,
    selectAll: vi.fn(async () => {
      page.selected = selects;
    }),
    sleep: async () => {},
  };
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
      collapseSelection: vi.fn(),
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

  // The read leaves the document selected, and the next key typed in the panel
  // would replace all of it.
  it.each([
    ['a finished edit', { oldText: 'false', text: 'true' }],
    ['a refused edit', { oldText: 'missing', text: 'x' }],
    ['an edit that changes nothing', { text: 'raw=false;' }],
  ])('leaves no selection after %s', async (_name, edit) => {
    const { io, page } = keyboardEditor('raw=false;');

    await fillCodeEditor(io, TARGET, edit);

    expect(io.collapseSelection).toHaveBeenCalled();
    expect(page.selected).toBe(false);
  });

  it('does not move the caret when nothing was selected', async () => {
    const { io } = keyboardEditor('raw=false;', { selects: false });

    await fillCodeEditor(io, TARGET, { text: 'x' });

    expect(io.collapseSelection).not.toHaveBeenCalled();
  });

  it('replaces a whole emoji, never half of its surrogate pair', async () => {
    const { io, page } = apiEditor('a😀b');

    await expect(fillCodeEditor(io, TARGET, { text: 'a😁b' })).resolves.toEqual({ handled: true });

    expect(page.doc).toBe('a😁b');
    const written = (io.evaluate as ReturnType<typeof vi.fn>).mock.calls
      .map(([script]) => script as string)
      .find((script) => script.includes('executeEdits'));
    expect(written).toContain('})(1, 3, "😁")');
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
      JSON.stringify({
        editors: [{ complete: false, lines: 2, text: 'ab', totalChars: 10 }],
        omitted: 3,
      }),
    );

    expect(block).toContain('visible lines only');
    expect(block).toContain('first 2 of 10 chars');
    expect(block).toContain('3 more code editor(s) not shown');
  });

  it('adds nothing for a page without editors or with bad data', () => {
    expect(formatCodeEditors(JSON.stringify({ editors: [], omitted: 0 }))).toBe('');
    expect(formatCodeEditors(undefined)).toBe('');
  });
});

describe('readCodeEditorsScript', () => {
  const pageWith = (texts: string[]) => {
    const roots = texts.map((text) => {
      const input = {};
      const root = {
        getBoundingClientRect: () => ({ height: 100, width: 100 }),
        querySelector: () => input,
        text,
      };
      Object.assign(input, { closest: () => root });
      return root;
    });
    const editors = roots.map((root) => ({
      getDomNode: () => ({ contains: () => false }),
      getModel: () => ({ getLanguageId: () => 'ts', getValue: () => root.text }),
      getOption: () => false,
      root,
    }));
    for (const editor of editors) {
      const node = editor.root as any;
      node.contains = () => false;
      editor.getDomNode = () => node;
    }
    vi.stubGlobal('document', { querySelectorAll: () => roots });
    vi.stubGlobal('window', {
      monaco: { editor: { EditorOption: { readOnly: 1 }, getEditors: () => editors } },
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares one budget across editors and counts the ones left out', () => {
    pageWith(['a'.repeat(8), 'b'.repeat(8), 'c'.repeat(8)]);

    const raw = (0, eval)(readCodeEditorsScript(10));
    const { editors, omitted } = JSON.parse(raw);

    expect(editors.map((editor: { text: string }) => editor.text)).toEqual([
      'a'.repeat(8),
      'b'.repeat(2),
    ]);
    expect(omitted).toBe(1);
    expect(countCodeEditors(raw)).toBe(3);
  });

  it('limits how many editors are listed, even empty ones', () => {
    pageWith(Array.from({ length: 20 }, () => ''));

    const { editors, omitted } = JSON.parse((0, eval)(readCodeEditorsScript(10)));

    expect(editors).toHaveLength(8);
    expect(omitted).toBe(12);
  });
});
