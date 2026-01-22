interface UriParserResult {
  base64: string | null;
  mimeType: string | null;
  type: 'url' | 'base64' | null;
}

export const parseDataUri = (dataUri: string): UriParserResult => {
  // Regular expression to match the entire Data URI structure
  const dataUriMatch = dataUri.match(/^data:([^;]+);base64,(.+)$/);

  if (dataUriMatch) {
    // If it's a valid Data URI
    return { base64: dataUriMatch[2], mimeType: dataUriMatch[1], type: 'base64' };
  }

  try {
    new URL(dataUri);
    // If it's a valid URL
    return { base64: null, mimeType: null, type: 'url' };
  } catch {
    // Neither a Data URI nor a valid URL
    return { base64: null, mimeType: null, type: null };
  }
};

/**
 * Maximum file size limits for Google Gemini file input
 * @see https://ai.google.dev/gemini-api/docs/file-input-methods#method-comparison
 *
 * Inline data: 100MB general, 50MB for PDFs
 */
const MAX_INLINE_DATA_SIZE = 100 * 1024 * 1024; // 100MB for inline data (general)
const MAX_INLINE_PDF_SIZE = 50 * 1024 * 1024; // 50MB for inline PDFs only

export { MAX_INLINE_DATA_SIZE, MAX_INLINE_PDF_SIZE };
