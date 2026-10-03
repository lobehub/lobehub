'use client';

import { type CSSProperties, memo, useMemo, useRef, useState } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

import { detectIndentStyle } from './indent';
import { getEditorLanguage } from './language';
import StatusBar from './StatusBar';
import { styles } from './style';
import { useCodeMirrorEditor } from './useCodeMirrorEditor';

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

    const isDark = useIsDark();
    const [lineWrapping, setLineWrapping] = useState(true);

    const editorLanguage = useMemo(
      () => (filePath ? getEditorLanguage(filePath) : undefined),
      [filePath],
    );
    const mode = editorLanguage?.mode ?? language ?? '';

    // Indentation is a property of the file, so it is sampled once from the
    // content the editor opened with rather than re-derived on every keystroke.
    const [indent] = useState(() => detectIndentStyle(value));

    const { cursor } = useCodeMirrorEditor({
      indent,
      isDark,
      lineWrapping,
      mode,
      onChange,
      onSave,
      readOnly,
      textareaRef,
      value,
    });

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
