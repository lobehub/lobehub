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
    const { applied } = cutOutFlatBackground(imageData);
    if (!applied) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;

    return new File([blob], 'full-body.png', { type: 'image/png' });
  } catch (error) {
    console.error('Failed to cut out the full-body background:', error);

    return;
  }
};
