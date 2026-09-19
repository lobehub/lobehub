'use client';

import { createGlobalStyle, cssVar } from 'antd-style';

import { HIGHLIGHT_REGISTRY } from './highlights';

/**
 * `::highlight()` is a document-level pseudo-element, so its rules can't live
 * in a scoped `createStaticStyles` block. Only a handful of properties are
 * honoured on it (colour, background, text-decoration, text-shadow), which is
 * exactly the vocabulary an annotation highlight needs.
 *
 * The warning ramp is the amber one in LobeHub's token set — the colour readers
 * already associate with "someone annotated this", not with an error.
 *
 * The underline carries the signal, not the fill: an annotation has to be
 * visible on a dense page without turning the sentence into a highlighter
 * stripe. It is drawn at `colorWarning` (warning-6, the saturated gold), not at
 * a border-weight token — warning-3 is pale enough to disappear against body
 * text. The three registries then step the fill rather than the hue: warning-1
 * resting, -2 while composing, -3 for the picked thread.
 */
const DocumentCommentHighlightStyle = createGlobalStyle`
  ::highlight(${HIGHLIGHT_REGISTRY.all}) {
    text-decoration: underline;
    text-decoration-color: ${cssVar.colorWarning};
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;

    background-color: ${cssVar.colorWarningBg};
  }

  ::highlight(${HIGHLIGHT_REGISTRY.pending}) {
    text-decoration: underline;
    text-decoration-color: ${cssVar.colorWarning};
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;

    background-color: ${cssVar.colorWarningBgHover};
  }

  ::highlight(${HIGHLIGHT_REGISTRY.active}) {
    text-decoration: underline;
    text-decoration-color: ${cssVar.colorWarningActive};
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;

    background-color: ${cssVar.colorWarningBorder};
  }
`;

export default DocumentCommentHighlightStyle;
