'use client';

// oxlint-disable-next-line stylex-migration/no-emotion-styles -- ::highlight() is document-level, no element to class
import { createGlobalStyle, cssVar } from '@lobehub/ui';

import { HIGHLIGHT_REGISTRY } from './highlights';

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
