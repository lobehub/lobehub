import { AGENT_DOCUMENT_DRAG_MIME } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { readDocumentDragData, writeDocumentDragData } from './documentDragData';
import { formatReferDocumentTag } from './referDocumentTag';

describe('documentDragData', () => {
  it('round-trips a document payload through the custom MIME', () => {
    const dataTransfer = new DataTransfer();
    writeDocumentDragData(dataTransfer, { documentId: 'doc-1', title: 'Style Guide' });

    expect(dataTransfer.types).toContain(AGENT_DOCUMENT_DRAG_MIME);
    expect(readDocumentDragData(dataTransfer)).toEqual({
      documentId: 'doc-1',
      title: 'Style Guide',
    });
  });

  it('does not react to unrelated drag data', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'doc-1');

    expect(readDocumentDragData(dataTransfer)).toBeUndefined();
  });

  it('rejects malformed data and payloads without an id', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(AGENT_DOCUMENT_DRAG_MIME, '{invalid');
    expect(readDocumentDragData(dataTransfer)).toBeUndefined();

    dataTransfer.setData(AGENT_DOCUMENT_DRAG_MIME, JSON.stringify({ title: 'Missing id' }));
    expect(readDocumentDragData(dataTransfer)).toBeUndefined();
  });

  it('uses an untitled fallback when the title is empty', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(AGENT_DOCUMENT_DRAG_MIME, JSON.stringify({ documentId: 'doc-1' }));

    expect(readDocumentDragData(dataTransfer)).toEqual({ documentId: 'doc-1', title: 'Untitled' });
  });
});

describe('formatReferDocumentTag', () => {
  it('serializes a self-closing refer_document tag', () => {
    expect(formatReferDocumentTag('doc-1', 'Style Guide')).toBe(
      '<refer_document name="Style Guide" id="doc-1" />',
    );
  });

  it('drops characters that would break the attribute or tag', () => {
    expect(formatReferDocumentTag('doc-1', 'A "quoted" <b>title</b>')).toBe(
      '<refer_document name="A quoted btitle/b" id="doc-1" />',
    );
  });
});
