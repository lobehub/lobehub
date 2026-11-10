export const REFER_DOCUMENT_TAG = 'refer_document';

/**
 * The self-closing tag parsers (remark render + server resolver) read quoted
 * attributes verbatim and do not decode entities, so drop the characters that
 * would end the attribute or the tag instead of escaping them.
 */
const sanitizeAttr = (value: string): string => value.replaceAll(/["<>]/g, '').trim();

/** Markdown wire format for a document reference inside a user message. */
export const formatReferDocumentTag = (documentId: string, title: string): string =>
  `<${REFER_DOCUMENT_TAG} name="${sanitizeAttr(title)}" id="${sanitizeAttr(documentId)}" />`;
