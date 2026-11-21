/**
 * Monaco support shared by both `lobe-browser` devices.
 *
 * Monaco keeps its text in a model and only mirrors a small window of it into a
 * 1×1 px input. Writing that input's value makes Monaco read the change as
 * typing over the mirrored window, so `const raw=false;` filled with `one`
 * became `onese;`. Edits therefore go through the editor's API, or through the
 * clipboard events it handles itself when the page does not expose the API, and
 * every edit is read back before it is reported as done.
 */

export interface CodeEditorInfo {
  /** False when only the rendered lines could be read. */
  complete: boolean;
  language?: string;
  lines: number;
  readOnly?: boolean;
  text: string;
}

export interface CodeEditorEdit {
  /** Replace this exact text, which must occur once, instead of the whole document. */
  oldText?: string;
  submit?: boolean;
  text: string;
}

export interface CodeEditorIO {
  /** Runs a script in the page and resolves its return value. */
  evaluate: (script: string) => Promise<unknown>;
  /** Sends a real select-all key press to the focused editor. */
  selectAll: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export type CodeEditorFillOutcome = { error?: string; handled: true } | { handled: false };

export const CODE_EDITOR_READ_MAX_CHARS = 12_000;

/** Lets Monaco render a selection or an applied edit before it is inspected. */
const EDITOR_SETTLE_MS = 120;

/** Page-side helpers, inlined into every script below and the desktop snapshot. */
export const CODE_EDITOR_PAGE_HELPERS = `
  const CODE_INPUT = 'textarea.inputarea, .native-edit-context';
  const codeRootOf = (el) => (el && el.closest ? el.closest('.monaco-editor') : null);
  const isCodeInput = (el) => !!el && !!el.matches && el.matches(CODE_INPUT) && !!codeRootOf(el);
  const toLf = (value) => String(value).replaceAll('\\r\\n', '\\n').replaceAll('\\r', '\\n');
  const codeApiOf = (root) => {
    const api = window.monaco && window.monaco.editor;
    if (!api || typeof api.getEditors !== 'function') return null;
    const editor = api.getEditors().find((item) => {
      const node = item.getDomNode && item.getDomNode();
      return !!node && (node === root || node.contains(root) || root.contains(node));
    });
    const model = editor && editor.getModel();
    return model ? { api, editor, model } : null;
  };
  const codeReadOnly = (bound) => {
    try { return !!bound.editor.getOption(bound.api.EditorOption.readOnly); } catch { return false; }
  };
  const renderedCode = (root) =>
    Array.from(root.querySelectorAll('.view-lines .view-line'))
      .map((line) => ({ text: line.textContent, top: parseFloat(line.style.top) || 0 }))
      .sort((a, b) => a.top - b.top)
      .map((line) => line.text.replaceAll('\\u00A0', ' ').replaceAll('\\u200C', ''))
      .join('\\n');
`;

/** The visible Monaco editors, with at most `maxChars` of each one's text. */
export const readCodeEditorsScript = (maxChars: number = CODE_EDITOR_READ_MAX_CHARS) => `(() => {
  try {
    ${CODE_EDITOR_PAGE_HELPERS}
    const editors = [];
    for (const root of document.querySelectorAll('.monaco-editor')) {
      const input = root.querySelector(CODE_INPUT);
      const box = root.getBoundingClientRect();
      if (!input || codeRootOf(input) !== root || box.width < 2 || box.height < 2) continue;
      const bound = codeApiOf(root);
      const text = bound ? toLf(bound.model.getValue()) : renderedCode(root);
      editors.push({
        complete: !!bound,
        language: bound ? bound.model.getLanguageId() : undefined,
        lines: text.split('\\n').length,
        readOnly: bound ? codeReadOnly(bound) : undefined,
        text: text.slice(0, ${maxChars}),
        totalChars: text.length,
      });
    }
    return JSON.stringify(editors);
  } catch {
    return '[]';
  }
})()`;

/** Whether keyboard focus is in a code editor's text, where a typed key edits the code. */
export const CODE_EDITOR_FOCUSED_SCRIPT = `(() => {
  ${CODE_EDITOR_PAGE_HELPERS}
  return isCodeInput(document.activeElement);
})()`;

export const codeEditorTypingError = (key: string) =>
  `Key "${key}" was not sent: focus is in a code editor, so it would be typed into the code. ` +
  'Use fill with the editor ref to change its text (oldText replaces one exact passage). ' +
  'If you meant to type into a command palette or dialog, it is not focused; check with a screenshot.';

const probeScript = (target: string) => `(() => {
  ${CODE_EDITOR_PAGE_HELPERS}
  const el = ${target};
  if (!isCodeInput(el)) return JSON.stringify({ isEditor: false });
  el.focus();
  const bound = codeApiOf(codeRootOf(el));
  return JSON.stringify({ hasApi: !!bound, isEditor: true, readOnly: !!bound && codeReadOnly(bound) });
})()`;

const apiReadScript = (target: string) => `(() => {
  ${CODE_EDITOR_PAGE_HELPERS}
  const bound = codeApiOf(codeRootOf(${target}));
  return JSON.stringify({ text: bound ? toLf(bound.model.getValue()) : null });
})()`;

/**
 * Replaces `[start, end)` of the LF-normalized text. Offsets become line and
 * column here because the model's own offsets count CRLF as two characters.
 */
const apiWriteScript = (
  target: string,
  start: number,
  end: number,
  text: string,
) => `((start, end, text) => {
  ${CODE_EDITOR_PAGE_HELPERS}
  const bound = codeApiOf(codeRootOf(${target}));
  if (!bound) return JSON.stringify({ ok: false });
  const current = toLf(bound.model.getValue());
  const at = (offset) => {
    const before = current.slice(0, offset);
    const lineBreak = before.lastIndexOf('\\n');
    return { column: offset - lineBreak, lineNumber: before.split('\\n').length };
  };
  const from = at(start);
  const to = at(end);
  const range = { endColumn: to.column, endLineNumber: to.lineNumber, startColumn: from.column, startLineNumber: from.lineNumber };
  bound.editor.pushUndoStop();
  const ok = bound.editor.executeEdits('lobe-browser', [{ forceMoveMarkers: true, range, text }]);
  bound.editor.pushUndoStop();
  return JSON.stringify({ ok: ok !== false });
})(${start}, ${end}, ${JSON.stringify(text)})`;

/**
 * Reads the current selection through the copy event Monaco answers itself.
 * `selected` guards a failed select-all: with nothing selected Monaco copies
 * the caret's line, and pasting over that would insert instead of replace.
 */
const captureScript = (target: string) => `(() => {
  ${CODE_EDITOR_PAGE_HELPERS}
  const el = ${target};
  if (!isCodeInput(el)) return JSON.stringify({ text: null });
  const root = codeRootOf(el);
  const clipboardData = new DataTransfer();
  el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
  return JSON.stringify({
    empty: renderedCode(root) === '',
    selected: !!root.querySelector('.selected-text'),
    text: toLf(clipboardData.getData('text/plain')),
  });
})()`;

const pasteScript = (target: string, text: string) => `((text) => {
  const el = ${target};
  el.focus();
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  return true;
})(${JSON.stringify(text)})`;

/** The document after an edit, or why the edit cannot be applied. */
export const applyCodeEdit = (
  current: string,
  { oldText, text }: CodeEditorEdit,
): { error: string } | { next: string } => {
  const replacement = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (oldText === undefined) return { next: replacement };

  const wanted = oldText.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (!wanted) return { error: 'oldText must not be empty' };
  const first = current.indexOf(wanted);
  if (first === -1) return { error: 'oldText was not found in the code editor; nothing changed' };
  if (current.includes(wanted, first + 1)) {
    return {
      error: 'oldText occurs more than once; include more surrounding text. Nothing changed',
    };
  }
  return { next: current.slice(0, first) + replacement + current.slice(first + wanted.length) };
};

/** The smallest `[start, end)` of `current` to replace to get `next`. */
const changedRange = (current: string, next: string) => {
  const limit = Math.min(current.length, next.length);
  let start = 0;
  while (start < limit && current[start] === next[start]) start += 1;
  let tail = 0;
  while (
    tail < limit - start &&
    current[current.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1;
  }
  return { end: current.length - tail, start, text: next.slice(start, next.length - tail) };
};

const parse = <T>(raw: unknown): T => JSON.parse(String(raw)) as T;

/**
 * Applies `edit` when `target` (a page expression) is a Monaco input.
 * `handled: false` means it is an ordinary field and the caller fills it.
 */
export const fillCodeEditor = async (
  io: CodeEditorIO,
  target: string,
  edit: CodeEditorEdit,
): Promise<CodeEditorFillOutcome> => {
  const rawProbe = await io.evaluate(probeScript(target));
  if (typeof rawProbe !== 'string') return { handled: false };
  const probe = parse<{ hasApi?: boolean; isEditor: boolean; readOnly?: boolean }>(rawProbe);
  if (!probe.isEditor) return { handled: false };

  const fail = (error: string): CodeEditorFillOutcome => ({ error, handled: true });
  if (edit.submit) {
    return fail(
      'submit does not apply to a code editor, where Enter inserts a line. Nothing changed',
    );
  }
  if (probe.readOnly) return fail('This code editor is read-only. Nothing changed');

  const settle = () =>
    (io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(EDITOR_SETTLE_MS);

  const read = async (): Promise<string | undefined> => {
    if (probe.hasApi) {
      return (
        parse<{ text: string | null }>(await io.evaluate(apiReadScript(target))).text ?? undefined
      );
    }
    await io.selectAll();
    await settle();
    const captured = parse<{ empty?: boolean; selected?: boolean; text: string | null }>(
      await io.evaluate(captureScript(target)),
    );
    if (captured.text === null) return undefined;
    if (captured.empty) return '';
    return captured.selected ? captured.text : undefined;
  };

  const current = await read();
  if (current === undefined) {
    return fail(
      'Could not read this code editor: the page hides its API and select-all did not reach it (the browser window may not be focused). Nothing changed',
    );
  }

  const applied = applyCodeEdit(current, edit);
  if ('error' in applied) return fail(applied.error);
  if (applied.next === current) return { handled: true };

  if (probe.hasApi) {
    const { end, start, text } = changedRange(current, applied.next);
    const written = parse<{ ok: boolean }>(
      await io.evaluate(apiWriteScript(target, start, end, text)),
    );
    if (!written.ok) return fail('The code editor refused the edit. Nothing changed');
  } else {
    // `read` left the whole document selected, so the paste replaces all of it.
    await io.evaluate(pasteScript(target, applied.next));
  }

  await settle();
  const after = await read();
  if (after === applied.next) return { handled: true };
  return fail(
    after === current
      ? 'The code editor ignored the edit (it may be read-only). Nothing changed'
      : 'The code editor text does not match what was written. Check it with readPage or a screenshot before saving, and undo with ControlOrMeta+z if needed',
  );
};

/** The block `readPage` appends so the model gets the code, not just the rendered lines. */
export const formatCodeEditors = (raw: unknown): string => {
  let editors: (CodeEditorInfo & { totalChars?: number })[];
  try {
    editors = JSON.parse(String(raw));
  } catch {
    return '';
  }
  if (!Array.isArray(editors)) return '';

  return editors
    .map(({ complete, language, lines, readOnly, text, totalChars }, index) => {
      const notes = [
        'monaco',
        language,
        `${lines} lines`,
        readOnly ? 'read-only' : undefined,
        complete ? undefined : 'visible lines only, tabs may show as spaces',
        (totalChars ?? 0) > text.length
          ? `first ${text.length} of ${totalChars} chars; use fill with oldText for edits`
          : undefined,
      ].filter(Boolean);
      const name = `code editor ${index + 1}`;
      return `\n\n--- ${name} (${notes.join(', ')}) ---\n${text}\n--- end of ${name} ---`;
    })
    .join('');
};
