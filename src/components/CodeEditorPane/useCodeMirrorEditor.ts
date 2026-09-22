import {
  type CodeMirrorOptions,
  type ICodeMirrorInstance,
  loadCodeMirror,
  lobeTheme,
} from '@lobehub/editor/codemirror';
import { type RefObject, useEffect, useRef, useState } from 'react';

import type { IndentStyle } from './indent';
import type { CursorPosition } from './StatusBar';

/**
 * The parts of the underlying CodeMirror 6 view that the compat wrapper does
 * not re-export. Reading the live selection is the only way to drive a cursor
 * readout, since the wrapper emits no `cursorActivity` event.
 */
interface EditorViewInternals {
  constructor: { theme: (spec: unknown, config: { dark: boolean }) => unknown };
  dispatch: (spec: { effects: unknown }) => void;
  dom: HTMLElement;
  state: {
    doc: { lineAt: (pos: number) => { from: number; number: number } };
    selection: { main: { from: number; head: number; to: number } };
  };
}

/**
 * Options the bundled wrapper handles at runtime but leaves out of its public
 * types. Each one is backed by a case in the bundle's `setOption` switch.
 */
interface ExtendedCodeMirrorOptions extends CodeMirrorOptions {
  autoCloseBrackets?: boolean;
  matchBrackets?: boolean;
  styleActiveLine?: boolean;
}

const setEditorOption = (
  instance: ICodeMirrorInstance | null,
  option: keyof ExtendedCodeMirrorOptions,
  value: unknown,
) => instance?.setOption(option as keyof CodeMirrorOptions, value);

const readCursor = (view: EditorViewInternals): CursorPosition => {
  const { from, head, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);

  return { column: head - line.from + 1, line: line.number, selectionLength: to - from };
};

export interface UseCodeMirrorEditorOptions {
  /** Sampled once from the content the editor opened with. */
  indent: IndentStyle;
  isDark: boolean;
  lineWrapping: boolean;
  mode: string;
  onChange?: (value: string) => void;
  onSave?: () => void | Promise<void>;
  readOnly: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
}

/**
 * Owns the CodeMirror instance lifecycle: creates it from the textarea once
 * the bundle finishes loading, pushes later prop changes through `setOption`,
 * and reports the cursor position for the status bar.
 */
export const useCodeMirrorEditor = ({
  indent,
  isDark,
  lineWrapping,
  mode,
  onChange,
  onSave,
  readOnly,
  textareaRef,
  value,
}: UseCodeMirrorEditorOptions) => {
  const instanceRef = useRef<ICodeMirrorInstance | null>(null);
  const [cursor, setCursor] = useState<CursorPosition>();

  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Sampled once at mount: the init effect below runs only once, so it reads
  // indentation through a ref to stay lint-clean.
  const indentRef = useRef(indent);

  // `value`, `mode`, `readOnly` and `lineWrapping` may change while
  // `loadCodeMirror()` is still pending. Their update effects run before the
  // instance exists and no-op, so the editor would initialize with mount-time
  // values; the init path reads the latest values through this ref.
  const latestRef = useRef({ value, mode, readOnly, lineWrapping });
  latestRef.current = { value, mode, readOnly, lineWrapping };

  useEffect(() => {
    if (!textareaRef.current) return;
    const dom = textareaRef.current;
    let disposed = false;
    let detachCursorListeners: (() => void) | undefined;

    loadCodeMirror().then((CodeMirror) => {
      if (disposed || instanceRef.current) return;
      const latest = latestRef.current;
      const options: ExtendedCodeMirrorOptions = {
        // Auto-closing a bracket in a file you cannot save is pure noise.
        autoCloseBrackets: !latest.readOnly,
        foldGutter: true,
        indentWithTabs: indentRef.current.useTabs,
        lineNumbers: true,
        lineWrapping: latest.lineWrapping,
        matchBrackets: true,
        mode: latest.mode,
        readOnly: latest.readOnly,
        styleActiveLine: true,
        tabSize: indentRef.current.size,
        theme: 'default',
        value: latest.value,
      };
      const instance = CodeMirror.fromTextArea(dom, options);

      const view = instance.view as unknown as EditorViewInternals;

      view.dispatch({
        effects: instance.optionHelper.theme.reconfigure(
          view.constructor.theme(lobeTheme, { dark: isDark }),
        ),
      });

      instance.on('change', () => {
        onChangeRef.current?.(instance.getValue());
      });
      instance.on('keydown', (_inst: ICodeMirrorInstance, e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          e.stopPropagation();
          onSaveRef.current?.();
        }
      });

      // `keyup` covers typing and caret keys, `mouseup` covers clicks and
      // drag-selection, `focusin` restores the readout when focus returns.
      const syncCursor = () => setCursor(readCursor(view));
      // Seed the readout so the status bar opens with a position rather than
      // a gap that only fills in once the file is touched.
      syncCursor();
      const events = ['keyup', 'mouseup', 'focusin'] as const;
      // Removed by `detachCursorListeners` in this effect's cleanup, which the
      // loader promise hides from static analysis.
      for (const event of events) view.dom.addEventListener(event, syncCursor);
      detachCursorListeners = () => {
        for (const event of events) view.dom.removeEventListener(event, syncCursor);
      };

      instanceRef.current = instance;
    });

    return () => {
      disposed = true;
      detachCursorListeners?.();
      if (instanceRef.current) {
        instanceRef.current.destroy();
        instanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    if (instance.getValue() !== value) instance.setValue(value);
  }, [value]);

  useEffect(() => {
    setEditorOption(instanceRef.current, 'mode', mode);
  }, [mode]);

  useEffect(() => {
    setEditorOption(instanceRef.current, 'readOnly', readOnly);
    setEditorOption(instanceRef.current, 'autoCloseBrackets', !readOnly);
  }, [readOnly]);

  useEffect(() => {
    setEditorOption(instanceRef.current, 'lineWrapping', lineWrapping);
  }, [lineWrapping]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const view = instance.view as unknown as EditorViewInternals;
    view.dispatch({
      effects: instance.optionHelper.theme.reconfigure(
        view.constructor.theme(lobeTheme, { dark: isDark }),
      ),
    });
  }, [isDark]);

  return { cursor };
};
