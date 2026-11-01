import { describe, expect, it } from 'vitest';

import { resolveContentType } from './index';

describe('resolveContentType', () => {
  it('keeps a full office mime as-is', () => {
    expect(
      resolveContentType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'a.docx',
      ),
    ).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('maps a bare extension fileType to its mime', () => {
    expect(resolveContentType('XLSX', 'report.bin')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('falls back to the filename extension when fileType is unusable', () => {
    expect(resolveContentType('application/octet-stream', 'Deck.PPTX')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
  });

  it('returns a generic binary mime when nothing matches', () => {
    expect(resolveContentType(undefined, 'notes')).toBe('application/octet-stream');
  });
});
