/**
 * Local previews of images this tab uploaded, keyed by uploaded file id.
 *
 * A sent message shows its images from their uploaded URL, which the browser has not
 * downloaded yet, so they would show as empty boxes until it does, although the composer
 * still holds each image as a local object URL. Message images look their file id up here
 * and show that copy instead. It lasts for the page's lifetime; after a reload, messages
 * fall back to the uploaded URL.
 */
const previews = new Map<string, string>();

export const rememberLocalImagePreview = (fileId: string, previewUrl: string) => {
  previews.set(fileId, previewUrl);
};

export const getLocalImagePreview = (fileId: string): string | undefined => previews.get(fileId);
