/**
 * Canonical Verilog / SystemVerilog file-type entries shared by the
 * FileViewer router and its regression tests.
 *
 * `FileViewer/index.tsx` spreads these into its production
 * CODE_EXTENSIONS / CODE_MIME_TYPES sets, so tests importing from here
 * exercise the exact values the shipped router consumes - dropping an
 * entry from either side fails the test instead of silently regressing
 * `.v` / `.sv` previews to the NotSupport view.
 */

export const VERILOG_FILE_EXTENSIONS = ['.v', '.sv'];

export const VERILOG_FILE_MIME_TYPES = [
  // Bare tokens: uploaded files may store the extension itself as fileType
  'v',
  'sv',
  // Mime values produced by `getMimeType` (@lobechat/utils)
  'text/x-verilog',
  'text/x-systemverilog',
] as const;

export interface VerilogFileTypeFields {
  fileName?: string | null;
  fileType?: string | null;
}

/**
 * Mirrors the FileViewer router decision for `.v` / `.sv` files: the stored
 * `fileType` is matched exactly against the canonical tokens (substring
 * matching is forbidden), and the filename is matched on extension suffix.
 */
export const matchesFileTypeGuard = (fields: VerilogFileTypeFields): boolean => {
  const lowerFileType = fields.fileType?.toLowerCase();
  const lowerFileName = fields.fileName?.toLowerCase();

  if (lowerFileType && VERILOG_FILE_MIME_TYPES.includes(lowerFileType as never)) return true;

  if (lowerFileName && VERILOG_FILE_EXTENSIONS.some((ext) => lowerFileName.endsWith(ext))) {
    return true;
  }

  return false;
};
