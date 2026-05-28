'use client';

import { type ICodeMirrorInstance, loadCodeMirror, lobeTheme } from '@lobehub/editor/codemirror';
import { createStaticStyles, cssVar } from 'antd-style';
import { type CSSProperties, memo, useEffect, useRef } from 'react';

const styles = createStaticStyles(
  ({ css }) => css`
    overflow: auto;
    width: 100%;
    height: 100%;
    background: ${cssVar.colorFillQuaternary};

    .cm-textarea {
      height: 0;
      opacity: 0;
    }
  `,
);

export interface CodeEditorPaneProps {
  className?: string;
  language: string;
  onChange?: (value: string) => void;
  /** Triggered when the user presses Cmd/Ctrl + S while the editor has focus. */
  onSave?: () => void | Promise<void>;
  readOnly?: boolean;
  style?: CSSProperties;
  value: string;
}

const CodeEditorPane = memo<CodeEditorPaneProps>(
  ({ value, language, style, className, readOnly = false, onChange, onSave }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const instanceRef = useRef<ICodeMirrorInstance | null>(null);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;

    useEffect(() => {
      if (!textareaRef.current) return;
      const dom = textareaRef.current;
      let disposed = false;

      loadCodeMirror().then((CodeMirror) => {
        if (disposed || instanceRef.current) return;
        const instance = CodeMirror.fromTextArea(dom, {
          lineNumbers: true,
          lineWrapping: true,
          mode: language,
          readOnly,
          theme: 'default',
          value,
        });
        instance.view.dispatch({
          effects: instance.optionHelper.theme.reconfigure(
            instance.view.constructor.theme(lobeTheme, { dark: false }),
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
        instanceRef.current = instance;
      });

      return () => {
        disposed = true;
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
      instanceRef.current?.setOption('mode', language);
    }, [language]);

    useEffect(() => {
      instanceRef.current?.setOption('readOnly', readOnly);
    }, [readOnly]);

    return (
      <div className={`${styles} ${className ?? ''}`.trim()} ref={containerRef} style={style}>
        <textarea className={'cm-textarea'} ref={textareaRef} />
      </div>
    );
  },
);

CodeEditorPane.displayName = 'CodeEditorPane';

export default CodeEditorPane;
