import mime from 'mime';

/** Extension carried by a url's path, or `''`. */
const extensionFromUrl = (url: string): string => {
  try {
    const { pathname } = new URL(url, 'https://a.com');
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot === -1) return '';

    const extension = pathname.slice(lastDot + 1).toLowerCase();
    // A dot that belongs to a directory name leaves a `/` in the tail, so the shape
    // check below rejects it without having to split the path.
    return /^[a-z\d]{1,8}$/.test(extension) ? extension : '';
  } catch {
    return '';
  }
};

/**
 * Give `fileName` an extension that matches what was actually downloaded.
 *
 * Callers build the name before the request, so they can only guess the extension
 * from the URL they are about to fetch — and a file proxy URL (`${APP_URL}/f/{id}`)
 * carries none, which leaves the name ending in a bare `.`. Browsers rewrite that
 * trailing dot because Windows forbids it, then read whatever follows the last
 * remaining dot as the extension: a name whose own text contains a period keeps a
 * nonsense extension instead of gaining the real one.
 *
 * The response settles it. The blob type is what the storage layer served, and the
 * final URL (after redirects) is the stored object. A name that already ends in an
 * equivalent extension is left alone; a recognized extension that contradicts the
 * downloaded content is replaced; anything else — prompt text that merely contains
 * a period — has the real extension appended after it.
 */
const withResolvedExtension = (fileName: string, mimeType: string, finalUrl: string): string => {
  // A trailing dot or space is invalid on Windows, and it is what makes the name
  // look like it already has an extension. Drop it before deciding.
  const base = fileName.replace(/[\s.]+$/, '');

  // Compare the essence: `Response.blob()` keeps Content-Type parameters, so a bare
  // equality check would let `application/octet-stream;charset=binary` through — and
  // `mime` ignores parameters and happily maps any octet-stream form to `.bin`.
  const essence = mimeType.split(';')[0].trim().toLowerCase();
  const fromMimeType =
    essence && essence !== 'application/octet-stream' ? mime.getExtension(essence) : null;
  const resolved = fromMimeType || extensionFromUrl(finalUrl);
  if (!resolved) return base;

  const lastDot = base.lastIndexOf('.');
  const current = lastDot === -1 ? '' : base.slice(lastDot + 1).toLowerCase();
  if (current === resolved) return base;

  // Two spellings of one format (`jpeg`/`jpg`, `tiff`/`tif`) are already correct. The
  // media type decides, so there is no alias list to keep in sync.
  const currentType = mime.getType(current);
  if (currentType && currentType === mime.getType(resolved)) return base;

  return currentType ? `${base.slice(0, lastDot)}.${resolved}` : `${base}.${resolved}`;
};

export interface DownloadFileOptions {
  /**
   * Rewrite the extension in `fileName` to the one the response reports.
   * Off by default: callers that already pass a correct extension must not
   * have it second-guessed.
   */
  resolveExtension?: boolean;
}

export const downloadFile = async (
  url: string,
  fileName: string,
  fallbackToOpen: boolean = true,
  { resolveExtension = false }: DownloadFileOptions = {},
) => {
  try {
    // Use better CORS handling similar to download-image.ts
    const response = await fetch(url, {
      // Avoid image disk cache which can cause incorrect CORS headers
      cache: 'no-store',

      credentials: 'omit',

      mode: 'cors',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    // Create download link
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = resolveExtension
      ? withResolvedExtension(fileName, blob.type, response.url || url)
      : fileName;
    link.style.display = 'none';

    // Trigger download
    document.body.append(link);
    link.click();

    // Cleanup
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.log('Download failed:', error);

    // Fallback: open in new tab if enabled
    if (fallbackToOpen) {
      window.open(url);
    } else {
      // Re-throw the error if fallback is disabled
      throw error;
    }
  }
};
