'use client';

import {
  type CodeMirrorOptions,
  type ICodeMirrorInstance,
  loadCodeMirror,
  lobeTheme,
} from '@lobehub/editor/codemirror';
import { type CSSProperties, memo, useEffect, useMemo, useRef, useState } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

import { detectIndentStyle } from './indent';
import { getEditorLanguage } from './language';
import StatusBar, { type CursorPosition } from './StatusBar';
import { styles } from './style';

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

export interface CodeEditorPaneProps {
  className?: string;
  /**
   * Path or filename of the edited file. Selects the grammar and names the
   * language in the status bar; takes precedence over `language`.
   */
  filePath?: string;
  /** Explicit CodeMirror grammar id, for content that has no file behind it. */
  language?: string;
  onChange?: (value: string) => void;
  /** Triggered when the user presses Cmd/Ctrl + S while the editor has focus. */
  onSave?: () => void | Promise<void>;
  readOnly?: boolean;
  /** Shows the cursor position, indentation, word wrap toggle and language. */
  showStatusBar?: boolean;
  style?: CSSProperties;
  value: string;
}

const CodeEditorPane = memo<CodeEditorPaneProps>(
  ({
    value,
    filePath,
    language,
    style,
    className,
    readOnly = false,
    showStatusBar = false,
    onChange,
    onSave,
  }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const instanceRef = useRef<ICodeMirrorInstance | null>(null);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;

    const isDark = useIsDark();
    const [lineWrapping, setLineWrapping] = useState(true);
    const [cursor, setCursor] = useState<CursorPosition>();

    const editorLanguage = useMemo(
      () => (filePath ? getEditorLanguage(filePath) : undefined),
      [filePath],
    );
    const mode = editorLanguage?.mode ?? language ?? '';

    // Indentation is a property of the file, so it is sampled once from the
    // content the editor opened with rather than re-derived on every keystroke.
    const [indent] = useState(() => detectIndentStyle(value));

    // Read once at mount: these seed the initial CodeMirror options, and each
    // has its own effect below to push later changes through `setOption`.
    const initialOptionsRef = useRef({ indent, lineWrapping, mode, readOnly });

    useEffect(() => {
      if (!textareaRef.current) return;
      const dom = textareaRef.current;
      let disposed = false;
      let detachCursorListeners: (() => void) | undefined;

      loadCodeMirror().then((CodeMirror) => {
        if (disposed || instanceRef.current) return;
        const initial = initialOptionsRef.current;
        const options: ExtendedCodeMirrorOptions = {
          // Auto-closing a bracket in a file you cannot save is pure noise.
          autoCloseBrackets: !initial.readOnly,
          foldGutter: true,
          indentWithTabs: initial.indent.useTabs,
          lineNumbers: true,
          lineWrapping: initial.lineWrapping,
          matchBrackets: true,
          mode: initial.mode,
          readOnly: initial.readOnly,
          styleActiveLine: true,
          tabSize: initial.indent.size,
          theme: 'default',
          value,
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
        // lint rule cannot follow across the loader promise.
        // eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

    return (
      <div className={`${styles.container} ${className ?? ''}`.trim()} style={style}>
        <div className={styles.editorArea}>
          <textarea className={'cm-textarea'} ref={textareaRef} />
        </div>
        {showStatusBar && (
          <StatusBar
            cursor={cursor}
            indent={indent}
            languageLabel={editorLanguage?.label ?? language ?? ''}
            lineWrapping={lineWrapping}
            readOnly={readOnly}
            onLineWrappingChange={setLineWrapping}
          />
        )}
      </div>
    );
  },
);

CodeEditorPane.displayName = 'CodeEditorPane';

export default CodeEditorPane;
