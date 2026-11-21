export const isAutomaticGifSize = (model: string, outputFormat: unknown) =>
  outputFormat === 'gif' && (model === 'gpt-image-2.6-flare' || model === 'gpt-image-2.6-sunburst');

/** Leave GIF dimensions to the API without changing the user's static-image preferences. */
export const normalizeImageGenerationParams = <T extends Record<string, unknown>>(
  params: T,
  model: string,
): T => {
  const outputFormat = 'outputFormat' in params ? params.outputFormat : params.output_format;
  if (!isAutomaticGifSize(model, outputFormat)) return params;

  const normalized = { ...params };
  delete normalized.size;
  return normalized;
};
