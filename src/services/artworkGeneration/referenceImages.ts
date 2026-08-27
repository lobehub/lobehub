export interface AttachedArtworkReferences {
  referenceImageUrl?: string;
  styleReferenceImageUrls: string[];
}

interface ResolveArtworkReferencesOptions {
  imageInputLimit: number;
  referenceImageUrl?: string | null;
  styleReferenceImageUrls?: string[] | null;
}

interface ResolvedArtworkReferences extends AttachedArtworkReferences {
  imageUrls?: string[];
}

const DATA_IMAGE_URL_PATTERN = /^data:image\//i;
const SUPPORTED_REMOTE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Converts a UI-facing image source into a reference that image models can read.
 * App-relative paths are resolved only when the caller supplies its origin, so
 * the service boundary can reject any relative value that escaped normalization.
 */
export const resolveArtworkReferenceImageUrl = (
  value?: string | null,
  appOrigin?: string,
): string | undefined => {
  const source = value?.trim();
  if (!source) return;

  if (DATA_IMAGE_URL_PATTERN.test(source)) return source;

  if (source.startsWith('/') && !source.startsWith('//')) {
    if (!appOrigin) return;

    try {
      const resolvedUrl = new URL(source, appOrigin);

      return SUPPORTED_REMOTE_PROTOCOLS.has(resolvedUrl.protocol)
        ? resolvedUrl.toString()
        : undefined;
    } catch {
      return;
    }
  }

  try {
    const url = new URL(source);

    return SUPPORTED_REMOTE_PROTOCOLS.has(url.protocol) ? source : undefined;
  } catch {
    return;
  }
};

/** Keeps prompt references and attached model inputs aligned after validation. */
export const resolveArtworkReferences = ({
  imageInputLimit,
  referenceImageUrl,
  styleReferenceImageUrls,
}: ResolveArtworkReferencesOptions): ResolvedArtworkReferences => {
  if (imageInputLimit <= 0) {
    return { imageUrls: undefined, referenceImageUrl: undefined, styleReferenceImageUrls: [] };
  }

  const attachedStyleReferences = (styleReferenceImageUrls ?? [])
    .flatMap((url) => {
      const resolvedUrl = resolveArtworkReferenceImageUrl(url);

      return resolvedUrl ? [resolvedUrl] : [];
    })
    .slice(0, imageInputLimit);
  const attachedReferenceImageUrl =
    attachedStyleReferences.length > 0
      ? undefined
      : resolveArtworkReferenceImageUrl(referenceImageUrl);
  const imageUrls =
    attachedStyleReferences.length > 0
      ? attachedStyleReferences
      : attachedReferenceImageUrl
        ? [attachedReferenceImageUrl]
        : undefined;

  return {
    imageUrls,
    referenceImageUrl: attachedReferenceImageUrl,
    styleReferenceImageUrls: attachedStyleReferences,
  };
};
