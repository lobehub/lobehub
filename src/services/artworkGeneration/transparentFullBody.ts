import { cutOutFlatBackground } from './cutOutFlatBackground';

/**
 * Turns a freshly generated full-body image into a transparent PNG.
 *
 * Returns `undefined` whenever the source cannot be read or the cut-out looks
 * untrustworthy, so callers fall back to the original artwork instead of
 * showing a half-erased character.
 */
export const cutOutFullBodyArtwork = async (url: string): Promise<File | undefined> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return;

    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(bitmap, 0, 0);
    bitmap.close();

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { applied, bounds } = cutOutFlatBackground(imageData);
    if (!applied || !bounds) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);

    // Crop to the character so the file's edges are its edges: the model frames
    // a standing figure with whatever margin it likes, and a surface cannot size
    // artwork it has to guess the padding of.
    const cropped = document.createElement('canvas');
    cropped.width = bounds.width;
    cropped.height = bounds.height;
    const croppedContext = cropped.getContext('2d');
    if (!croppedContext) return;

    croppedContext.drawImage(
      canvas,
      bounds.left,
      bounds.top,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );

    const blob = await new Promise<Blob | null>((resolve) => cropped.toBlob(resolve, 'image/png'));
    if (!blob) return;

    return new File([blob], 'full-body.png', { type: 'image/png' });
  } catch (error) {
    console.error('Failed to cut out the full-body background:', error);

    return;
  }
};
