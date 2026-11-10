'use client';

import {
  type CodeMirrorOptions,
  type ICodeMirrorInstance,
  loadCodeMirror,
  lobeTheme,
} from '@lobehub/editor/codemirror';
// oxlint-disable-next-line stylex-migration/no-emotion-styles -- CodeMirror renders its own DOM without slots
import { createStaticStyles, cx } from '@lobehub/ui';
import { type CSSProperties, memo, useEffect, useMemo, useRef, useState } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

import { detectIndentStyle } from './indent';
import { getEditorLanguage } from './language';
import StatusBar, { type CursorPosition } from './StatusBar';

const fallback = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    height: 100%;

    background: ${cssVar.colorBgContainer};

    .cm-textarea {
      height: 0;
      opacity: 0;
    }
  `,
  /*
   * Selectors are one level deeper than the CodeMirror theme emits
   * (.cm-editor.cm-editor) so these rules win regardless of which style sheet
   * the browser inserted last.
   */
  editorArea: css`
    overflow: hidden;
    flex: 1;
    min-height: 0;

    .cm-editor {
      height: 100%;
      padding-block: 0;
    }

    /* Own the vertical scroll here rather than in an outer wrapper, so the
       gutter and the fold markers stay pinned while the text scrolls. */
    .cm-scroller {
      overflow: auto;
      font-variant-ligatures: none;
      line-height: 20px;
    }

    .cm-editor.cm-editor span,
    .cm-editor.cm-editor .cm-line {
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      line-height: 20px;
    }

    /* Clicking below the last line should still land in the document, the way
       every desktop editor behaves. */
    .cm-content {
      min-height: 100%;
      padding-block: 8px;
    }

    .cm-gutters {
      user-select: none;
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgContainer};
    }

    /* The bundled theme pads every line by 12px, which lands on top of the
       gutter's own trailing space and pushes the code away from its number. */
    .cm-editor.cm-editor .cm-line {
      padding-inline: 6px 12px;
    }

    /* The number sits closer to the code than to the pane edge: it labels the
       line, so the eye should travel from it rightwards, not across a gap. */
    .cm-lineNumbers .cm-gutterElement {
      min-width: 22px;
      padding-inline: 16px 2px;

      font-family: ${cssVar.fontFamilyCode};
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      line-height: 20px;
      color: ${cssVar.colorTextQuaternary};
    }

    /* The bundle carries a base style that paints the caret's line and gutter a
       hard-coded near-white, in dark mode too, and qualifies both of them with
       the editor class. Naming that class twice is what outranks it: otherwise
       the focused line reads as a white band with its punctuation washed out. */
    .cm-editor.cm-editor .cm-activeLineGutter {
      color: ${cssVar.colorText} !important;
      background: transparent;
    }

    .cm-editor.cm-editor .cm-activeLine {
      background: ${cssVar.colorFillQuaternary};
    }

    /* A focused editor gets the stronger cue; an unfocused one keeps a faint
       marker so the caret position is still findable after a click elsewhere. */
    .cm-editor.cm-editor:not(.cm-focused) .cm-activeLine {
      background: transparent;
    }

    .cm-matchingBracket,
    .cm-editor.cm-focused .cm-matchingBracket {
      border-radius: 2px;
      background: ${cssVar.colorFillSecondary};
      outline: 1px solid ${cssVar.colorBorder};
    }

    .cm-nonmatchingBracket {
      border-radius: 2px;
      background: ${cssVar.colorErrorBg};
    }

    /* Fold markers render as empty divs; the chevron is entirely ours. */
    .gutter-fold-open,
    .gutter-fold-close {
      cursor: pointer;

      display: flex;
      align-items: center;
      justify-content: center;

      width: 13px;
      height: 20px;

      color: ${cssVar.colorTextTertiary};

      transition: opacity 0.15s;
    }

    .gutter-fold-open::before,
    .gutter-fold-close::before {
      content: '';

      width: 5px;
      height: 5px;
      border-block-end: 1.4px solid currentcolor;
      border-inline-end: 1.4px solid currentcolor;
    }

    /* Pointing down: this range is expanded. Only offered on gutter hover, so
       the gutter is not a column of permanent arrows. */
    .gutter-fold-open {
      opacity: 0;
    }

    .gutter-fold-open::before {
      transform: translateY(-1px) rotate(45deg);
    }

    /* Pointing right: content is hidden here, so this one always shows. */
    .gutter-fold-close::before {
      transform: translateX(-2px) rotate(-45deg);
    }

    .gutter-fold-open:hover,
    .gutter-fold-close:hover {
      color: ${cssVar.colorText};
    }

    .cm-gutters:hover .gutter-fold-open {
      opacity: 1;
    }

    .cm-editor.cm-editor .cm-foldPlaceholder {
      width: auto;
      height: auto;
      padding-inline: 6px;
      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: 4px;

      font-size: 11px;
      color: ${cssVar.colorTextTertiary};

      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

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
        // eslint-disable-next-line @eslint-react/web-api-no-leaked-event-listener
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
      <div className={cx(fallback.container, className)} style={style}>
        <div className={fallback.editorArea}>
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
