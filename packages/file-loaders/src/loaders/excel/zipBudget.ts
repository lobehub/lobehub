import type { Readable } from 'node:stream';

import yauzl from 'yauzl';

import { FileParseBudgetError } from '../../fileParseBudget';

export interface XlsxZipLimits {
  maxEntries: number;
  /** Compressed input size. */
  maxInputBytes: number;
  /** Uncompressed bytes over all entries, declared and actually inflated. */
  maxTotalBytes: number;
  /** Uncompressed bytes of any single worksheet part, declared and actually inflated. */
  maxWorksheetBytes: number;
}

/**
 * Fixed structural budgets for an xlsx archive. The input budget matches the 64 MiB in-memory
 * parse cap used elsewhere (`MAX_FILE_PARSE_SIZE`); it is enforced here too because this
 * helper cannot assume every caller applied that cap. No compression-ratio check: a styled but
 * empty sheet compresses extremely well and is legitimate.
 */
export const DEFAULT_XLSX_ZIP_LIMITS: XlsxZipLimits = {
  maxEntries: 5000,
  maxInputBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxWorksheetBytes: 256 * 1024 * 1024,
};

const WORKSHEET_PART = /(?:^|\/)worksheets\/[^/]+\.xml$/i;

const isZip = (data: Uint8Array) => data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b;

/**
 * Checks an xlsx (ZIP) before SheetJS inflates it, without ever holding inflated data:
 * 1. compressed input size and entry count,
 * 2. the sizes the central directory declares,
 * 3. every entry is streamed through yauzl (with its size validation on) and the bytes that
 *    actually come out are counted against the same total / worksheet budgets. Chunks are
 *    discarded, never accumulated, and the stream is aborted as soon as a budget is crossed.
 *
 * An archive whose real content disagrees with its declared sizes, or that cannot be read, is
 * rejected with yauzl's ordinary error (a corrupt file, not a budget refusal). Only a budget
 * overrun throws `FileParseBudgetError`. Both the active entry stream and the ZIP handle are
 * closed on every path. Data that is not a ZIP (legacy .xls) passes untouched.
 */
export const preflightXlsxZip = (
  input: Uint8Array,
  limits: XlsxZipLimits = DEFAULT_XLSX_ZIP_LIMITS,
): Promise<void> => {
  if (!isZip(input)) return Promise.resolve();

  if (input.byteLength > limits.maxInputBytes) {
    return Promise.reject(
      new FileParseBudgetError('zip-input', limits.maxInputBytes, input.byteLength),
    );
  }

  const buffer = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error('Failed to open zip from buffer'));

      let settled = false;
      let active: Readable | undefined;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        active?.destroy();
        active = undefined;
        zipfile.close();
        if (error) reject(error);
        else resolve();
      };

      if (zipfile.entryCount > limits.maxEntries) {
        return finish(
          new FileParseBudgetError('zip-entries', limits.maxEntries, zipfile.entryCount),
        );
      }

      let declaredTotal = 0;
      let inflatedTotal = 0;

      const checkSizes = (entryBytes: number, total: number, isSheet: boolean) => {
        if (isSheet && entryBytes > limits.maxWorksheetBytes) {
          return new FileParseBudgetError('sheet-xml', limits.maxWorksheetBytes, entryBytes);
        }
        if (total > limits.maxTotalBytes) {
          return new FileParseBudgetError('zip-expansion', limits.maxTotalBytes, total);
        }
      };

      zipfile.on('entry', (entry: yauzl.Entry) => {
        const isSheet = WORKSHEET_PART.test(entry.fileName);

        declaredTotal += entry.uncompressedSize;
        const declaredError = checkSizes(entry.uncompressedSize, declaredTotal, isSheet);
        if (declaredError) return finish(declaredError);

        // Directory entries have no content stream
        if (entry.fileName.endsWith('/')) return zipfile.readEntry();

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return finish(streamErr || new Error('Failed to open entry'));
          if (settled) return stream.destroy();

          active = stream;
          let entryBytes = 0;
          stream.on('data', (chunk: Buffer) => {
            entryBytes += chunk.length;
            inflatedTotal += chunk.length;
            const actualError = checkSizes(entryBytes, inflatedTotal, isSheet);
            if (actualError) finish(actualError);
          });
          stream.on('error', finish);
          stream.on('end', () => {
            if (settled) return;
            active = undefined;
            zipfile.readEntry();
          });
        });
      });
      zipfile.on('end', () => finish());
      zipfile.on('error', finish);
      zipfile.readEntry();
    });
  });
};
