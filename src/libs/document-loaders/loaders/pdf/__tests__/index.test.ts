// @vitest-environment node
import pdfParse from 'pdf-parse';
import { expect, vi } from 'vitest';

import { MAX_PDF_PAGES } from '../../config';
import { PdfLoader } from '../index';

vi.mock('pdf-parse', () => ({ default: vi.fn() }));

describe('PdfLoader', () => {
  it('should reject PDFs with too many pages', async () => {
    vi.mocked(pdfParse).mockResolvedValueOnce({
      numpages: MAX_PDF_PAGES + 1,
      text: 'too many pages',
    } as any);

    await expect(PdfLoader(new Blob(['pdf']))).rejects.toThrow(
      'PDF page count exceeds maximum allowed limit',
    );
  });
});
