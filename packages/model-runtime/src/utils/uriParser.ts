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
