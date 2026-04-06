export function preserveSupportedParams<
  TParams extends Record<string, unknown>,
  TSchema extends Record<string, unknown>,
  TKey extends keyof TParams & string,
>(
  previousParameters: TParams,
  nextDefaultValues: TParams,
  nextSchema: TSchema,
  keys: readonly TKey[],
): TParams {
  const supportedPreservedEntries = keys.flatMap((key) => {
    if (!(key in nextSchema)) return [];

    const value = previousParameters[key];
    if (typeof value === 'undefined') return [];

    return [[key, value] as const];
  });

  return {
    ...nextDefaultValues,
    ...Object.fromEntries(supportedPreservedEntries),
  };
}

export function normalizeImageInputOnSchemaSwitch<
  TParams extends Record<string, unknown> & {
    imageUrl?: unknown;
    imageUrls?: unknown;
  },
  TSchema extends Record<string, unknown>,
>(previousParameters: TParams, nextSchema: TSchema, preservedResult: TParams): TParams {
  const result = { ...preservedResult };

  const imageUrl = previousParameters.imageUrl;
  const imageUrls = previousParameters.imageUrls;
  const supportsImageUrl = 'imageUrl' in nextSchema;
  const supportsImageUrls = 'imageUrls' in nextSchema;

  // Multi-image -> Single-image
  if (
    Array.isArray(imageUrls) &&
    imageUrls.length > 0 &&
    !supportsImageUrls &&
    supportsImageUrl &&
    !result.imageUrl
  ) {
    result.imageUrl = imageUrls[0];
  }

  // Single-image -> Multi-image
  if (
    typeof imageUrl === 'string' &&
    imageUrl &&
    supportsImageUrls &&
    !supportsImageUrl &&
    !(Array.isArray(result.imageUrls) && result.imageUrls.length > 0)
  ) {
    result.imageUrls = [imageUrl];
  }

  return result;
}
