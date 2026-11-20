export const screenshotCaptureLimit = 24;

/** Keep a bounded pixel fallback, reserving one capture for each later variant. */
export const shouldCaptureScreenshot = (
  variants: string[],
  capturedVariants: string[],
  variant: string,
  hasDifferences: boolean,
) => {
  const limit = screenshotCaptureLimit;
  if (capturedVariants.length >= limit) return false;
  if (!capturedVariants.includes(variant)) return true;
  const reserved = variants.filter((id) => !capturedVariants.includes(id)).length;
  return hasDifferences && capturedVariants.length + reserved < limit;
};
