const IMAGE_METADATA_TIMEOUT_MS = 5000;

/**
 * Extract intrinsic dimensions from an image File or base64 data URI.
 * Unsupported browser APIs, decoding failures and metadata timeouts return
 * undefined so optional dimension discovery cannot stall an upload.
 */
export const getImageDimensions = async (
  source: File | string,
): Promise<{ height: number; ratio: number; width: number } | undefined> => {
  if (typeof source === 'string') {
    if (!source.startsWith('data:image/')) return undefined;
  } else if (!source.type.startsWith('image/')) {
    return undefined;
  }

  if (typeof Image === 'undefined') return undefined;

  let img: HTMLImageElement;
  let objectUrl: string | undefined;
  try {
    img = new Image();
    if (typeof source !== 'string') objectUrl = URL.createObjectURL(source);
  } catch {
    return undefined;
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const settle = (dimensions?: { height: number; ratio: number; width: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        img.removeEventListener('load', handleLoad);
        img.removeEventListener('error', handleError);
        img.removeAttribute('src');
      } catch {
        // Cleanup failures must not leave optional metadata requests pending.
      }
      try {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      } catch {
        // Revocation is best-effort when a browser API is unavailable.
      }
      resolve(dimensions);
    };

    const handleLoad = () => {
      const height = img.naturalHeight;
      const width = img.naturalWidth;
      settle({
        height,
        ratio: height > 0 ? Math.round((width / height) * 10_000) / 10_000 : 0,
        width,
      });
    };
    const handleError = () => settle();

    try {
      img.addEventListener('load', handleLoad);
      img.addEventListener('error', handleError);
      timeout = setTimeout(() => settle(), IMAGE_METADATA_TIMEOUT_MS);
      img.src = typeof source === 'string' ? source : objectUrl!;
    } catch {
      settle();
    }
  });
};
