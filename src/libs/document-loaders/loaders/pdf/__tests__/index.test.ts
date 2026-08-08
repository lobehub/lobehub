// @vitest-environment node
import pdfParse from 'pdf-parse';
import { expect, vi } from 'vitest';

import { MAX_PDF_PAGES } from '../../config';
import { PdfLoader } from '../index';

vi.mock('pdf-parse', () => ({ default: vi.fn() }));

describe('PdfLoader', () => {
  it('should stop parsing at the page cap before rejecting an oversized PDF', async () => {
    let renderedPages = 0;
    vi.mocked(pdfParse).mockImplementationOnce(async (_buffer, options) => {
      const totalPages = MAX_PDF_PAGES + 1;
      renderedPages = Math.min(totalPages, options?.max || totalPages);

      return {
        numpages: totalPages,
        numrender: renderedPages,
        text: 'bounded parse result',
      } as any;
    });

    await expect(PdfLoader(new Blob(['pdf']))).rejects.toThrow(
      'PDF page count exceeds maximum allowed limit',
    );
    expect(pdfParse).toHaveBeenCalledWith(expect.any(Buffer), { max: MAX_PDF_PAGES });
    expect(renderedPages).toBe(MAX_PDF_PAGES);
  });
});
