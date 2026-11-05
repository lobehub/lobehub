'use client';

// oxlint-disable-next-line stylex-migration/no-plain-css -- ::highlight() registries are document-level pseudo-elements with no element to attach a StyleX class to
import './HighlightStyle.css';

/**
 * The paint for the CSS Custom Highlight registries lives in HighlightStyle.css
 * (`::highlight()` is document-level, so it cannot be a scoped class). Mounting
 * this component loads that stylesheet.
 */
const DocumentCommentHighlightStyle = () => null;

export default DocumentCommentHighlightStyle;
