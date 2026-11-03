interface UriParserResult {
  base64: string | null;
  mimeType: string | null;
  type: 'url' | 'base64' | null;
}

export const parseDataUri = (dataUri: string): UriParserResult => {
  // Use indexOf instead of regex to avoid stack overflow on large data URIs (e.g. 26MB+ base64 images)
  const DATA_PREFIX = 'data:';
  const BASE64_MARKER = ';base64,';

  if (dataUri.startsWith(DATA_PREFIX)) {
    const markerIndex = dataUri.indexOf(BASE64_MARKER);
    if (markerIndex > DATA_PREFIX.length) {
      const mimeType = dataUri.slice(DATA_PREFIX.length, markerIndex);
      const base64 = dataUri.slice(markerIndex + BASE64_MARKER.length);
      if (base64.length > 0) {
        return { base64, mimeType, type: 'base64' };
      }
    }
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
