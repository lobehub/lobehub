/**
 * Helper function to extract image dimensions from File objects or base64 data URIs
 * @param source The image source - either a File object or base64 data URI string
 * @returns Promise resolving to dimensions (incl. aspect ratio) or undefined if not an image or error occurs
 */
export const getImageDimensions = async (
  source: File | string,
): Promise<{ height: number; ratio: number; width: number } | undefined> => {
  // Type guard and validation
  if (typeof source === 'string') {
    // Handle base64 data URI
    if (!source.startsWith('data:image/')) return undefined;
  } else {
    // Handle File object
    if (!source.type.startsWith('image/')) return undefined;
  }

  return new Promise((resolve) => {
    const img = new Image();
    let objectUrl: string | null = null;

    const handleLoad = () => {
      const height = img.naturalHeight;
      const width = img.naturalWidth;
      resolve({
        height,
        // intrinsic aspect ratio (width / height), rounded to avoid float noise;
        // 0 when height is missing to avoid Infinity/NaN
        ratio: height > 0 ? Math.round((width / height) * 10_000) / 10_000 : 0,
        width,
      });
      // Clean up object URL if created
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };

    const handleError = () => {
      // Clean up object URL if created
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      resolve(undefined);
    };

    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);

    // Set source based on input type
    if (typeof source === 'string') {
      // Base64 data URI - use directly
      img.src = source;
    } else {
      // File object - create object URL
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    }
  });
};
