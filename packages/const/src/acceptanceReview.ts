export const ACCEPTANCE_CLIENT_ID = 'lobehub-acceptance';

export const ACCEPTANCE_EXTENSION_CLIENT_ID = 'lobehub-acceptance-extension';

export const ACCEPTANCE_EXTENSION_RESOURCE = 'urn:lobehub:acceptance-extension';

export const ACCEPTANCE_EXTENSION_SCOPE = 'acceptance:extension';

export const ACCEPTANCE_EXTENSION_TOKEN_TTL_SECONDS = 60 * 60;

// Pinned by the `key` in the extension manifest; the Chrome Web Store ID joins
// once the listing exists.
export const ACCEPTANCE_EXTENSION_IDS = ['fjgpjfdackkmgdldjiebkhkdacbibhnb'];

/**
 * URL parameter that activates the acceptance toolbar (`@lobehub/acceptance-sdk`). A
 * page mounts the toolbar only when its URL carries this parameter; the SDK
 * persists the value in sessionStorage and strips the parameter afterwards.
 */
export const ACCEPTANCE_REVIEW_ACTIVATION_PARAM = 'lh-acceptance';

export const ACCEPTANCE_REVIEW_SCOPE = 'acceptance:review';

export const ACCEPTANCE_REVIEW_RESOURCE_PREFIX = 'urn:lobehub:acceptance:';

export const ACCEPTANCE_REVIEW_TOKEN_TTL_SECONDS = 8 * 60 * 60;

const RESOURCE_PATTERN = /^urn:lobehub:acceptance:([\w-]{1,64})(?::([^:]+))?$/;

export const acceptanceReviewResource = (acceptanceId: string, origin: string) =>
  `${ACCEPTANCE_REVIEW_RESOURCE_PREFIX}${acceptanceId}:${encodeURIComponent(origin)}`;

export const acceptanceReviewFromResource = (
  resource: unknown,
): { acceptanceId: string; origin?: string } | undefined => {
  if (typeof resource !== 'string') return undefined;
  const match = RESOURCE_PATTERN.exec(resource);
  if (!match) return undefined;
  if (!match[2]) return { acceptanceId: match[1] };
  try {
    return { acceptanceId: match[1], origin: decodeURIComponent(match[2]) };
  } catch {
    return undefined;
  }
};

export const acceptanceIdFromReviewResource = (resource: unknown): string | undefined =>
  acceptanceReviewFromResource(resource)?.acceptanceId;

export const SITE_REVIEW_RESOURCE_PREFIX = 'urn:lobehub:site:';

const SITE_RESOURCE_PATTERN = /^urn:lobehub:site:(psite_\w{12}):([^:]+)$/;

export const siteReviewResource = (siteId: string, origin: string) =>
  `${SITE_REVIEW_RESOURCE_PREFIX}${siteId}:${encodeURIComponent(origin)}`;

export const siteReviewFromResource = (
  resource: unknown,
): { origin: string; siteId: string } | undefined => {
  const value = Array.isArray(resource) ? resource[0] : resource;
  if (typeof value !== 'string') return undefined;
  const match = SITE_RESOURCE_PATTERN.exec(value);
  if (!match) return undefined;
  try {
    return { origin: decodeURIComponent(match[2]), siteId: match[1] };
  } catch {
    return undefined;
  }
};

export const isReviewResource = (resource: unknown) =>
  (Array.isArray(resource) ? resource : [resource]).some(
    (value) =>
      typeof value === 'string' &&
      (value.startsWith(ACCEPTANCE_REVIEW_RESOURCE_PREFIX) ||
        value.startsWith(SITE_REVIEW_RESOURCE_PREFIX)),
  );
