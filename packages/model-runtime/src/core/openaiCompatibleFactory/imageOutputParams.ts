/**
 * OpenAI Images API output controls shared by the OpenAI-compatible and Azure OpenAI runtimes.
 *
 * Standard image params are camelCase, while the Images API expects snake_case fields.
 * Animated GIF output (GPT Image 2.6) is only available on `v1/images/generations`; the edit
 * endpoint rejects it, and the frame fields are only valid together with `output_format: "gif"`.
 * @see https://developers.openai.com/api/docs/guides/image-generation
 */

const OUTPUT_PARAM_FIELDS = {
  frameCount: 'frame_count',
  frameDurationMs: 'frame_duration_ms',
  outputFormat: 'output_format',
} as const;

const GIF_ONLY_FIELDS = ['frame_count', 'frame_duration_ms'] as const;

const OUTPUT_FORMAT_MIME_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const GIF_EDIT_UNSUPPORTED_MESSAGE =
  'Animated GIF output does not support reference images. Remove the reference images or choose another output format.';

/**
 * Rename output controls to Images API fields in place and drop frame fields unless the
 * request asks for a GIF. Throws when a GIF is requested on the edit endpoint.
 */
export const applyImageOutputParams = (
  userInput: Record<string, any>,
  { isImageEdit }: { isImageEdit: boolean },
): void => {
  for (const [paramName, field] of Object.entries(OUTPUT_PARAM_FIELDS)) {
    if (!(paramName in userInput)) continue;
    userInput[field] = userInput[paramName];
    delete userInput[paramName];
  }

  if (userInput.output_format === 'gif') {
    if (isImageEdit) throw new Error(GIF_EDIT_UNSUPPORTED_MESSAGE);
    return;
  }

  for (const field of GIF_ONLY_FIELDS) delete userInput[field];
};

/**
 * MIME type for a base64 image result. The response reports the format it produced; fall back to
 * the requested format, then to PNG, the Images API default.
 */
export const resolveImageOutputMimeType = (
  responseFormat?: string | null,
  requestedFormat?: string | null,
): string =>
  OUTPUT_FORMAT_MIME_TYPES[responseFormat ?? ''] ??
  OUTPUT_FORMAT_MIME_TYPES[requestedFormat ?? ''] ??
  'image/png';
