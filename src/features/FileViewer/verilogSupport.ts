/**
 * Shared Verilog/SystemVerilog detection for the FileViewer (T-331).
 *
 * `FileViewer/index.tsx` keeps its own CODE_EXTENSIONS/CODE_MIME_TYPES sets for
 * routing; this module exports the canonical extension/MIME entries plus a
 * re-usable matcher so tests (and future consumers) can assert routing intent
 * without duplicating the raw lists.
 */

export const VERILOG_FILE_EXTENSIONS = ['.v', '.sv'];

export const VERILOG_FILE_TYPES = new Set(['v', 'sv']);

export interface VerilogFileTypeFields {
  fileName?: string | null;
  fileType?: string | null;
}

/**
 * Mirrors `matchesFileType` semantics from `FileViewer/index.tsx`: the stored
 * `fileType` is matched exactly against the MIME set (substring matching is
 * forbidden), and the filename is matched on extension suffix.
 */
export const matchesFileTypeGuard = (fields: VerilogFileTypeFields): boolean => {
  const lowerFileType = fields.fileType?.toLowerCase();
  const lowerFileName = fields.fileName?.toLowerCase();

  if (lowerFileType && VERILOG_FILE_TYPES.has(lowerFileType)) return true;

  if (lowerFileName && VERILOG_FILE_EXTENSIONS.some((ext) => lowerFileName.endsWith(ext))) {
    return true;
  }

  return false;
};
