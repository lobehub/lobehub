import { createStaticStyles, cssVar } from 'antd-style';

/**
 * The editor chrome. Selectors are one level deeper than the CodeMirror theme
 * emits (`.cm-editor.cm-editor`) so these rules win regardless of which style
 * sheet the browser inserted last.
 */
export const styles = createStaticStyles(({ css }) => ({
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

      &::before {
        content: '';

        width: 5px;
        height: 5px;
        border-block-end: 1.4px solid currentcolor;
        border-inline-end: 1.4px solid currentcolor;
      }
    }

    /* Pointing down: this range is expanded. Only offered on gutter hover, so
       the gutter is not a column of permanent arrows. */
    .gutter-fold-open {
      opacity: 0;

      &::before {
        transform: translateY(-1px) rotate(45deg);
      }
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
