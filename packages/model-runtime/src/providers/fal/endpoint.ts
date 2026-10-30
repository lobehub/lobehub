/**
 * Short ids saved before model cards carried fal's `fal-ai/` namespace (e.g. `flux/dev`). Any
 * other id with a `/` is a full fal endpoint id (`bytedance/seedance-2.5`,
 * `black-forest-labs/flux-2`, `<user>/<app>`) and is used verbatim.
 */
const LEGACY_SHORT_ID_PREFIXES = [
  'flux/',
  'flux-kontext/',
  'flux-pro/',
  'hunyuan-image/',
  'imagen4/',
];

/**
 * Legacy short ids under an owner fal also uses at the top level: `bytedance/seedream/v4` meant
 * `fal-ai/bytedance/seedream/v4`, while newer releases live at `bytedance/seedream/v5/...`, so
 * only these exact ids are rewritten.
 */
const LEGACY_SHORT_IDS = new Set(['bytedance/seedream/v4', 'bytedance/seedream/v4.5']);

/**
 * Model families exposed as one card but served by separate fal endpoints: requests with
 * reference images go to `/edit`, others to `/text-to-image`. Only the family root matches, so
 * an id that already names its task (e.g. `.../v4/edit`) is sent as is.
 */
const EDIT_OR_TEXT_TO_IMAGE_FAMILIES = [
  /^fal-ai\/bytedance\/seedream\/v[\d.]+$/,
  /^fal-ai\/hunyuan-image\/v[\d.]+$/,
  /^alibaba\/qwen-image-3$/,
];

/** Image cards whose `/edit` endpoint serves requests with reference images */
const EDIT_WITH_IMAGES_MODELS = new Set(['fal-ai/nano-banana']);

/**
 * Turn a model id into the fal endpoint id it runs on. fal endpoint ids are always
 * `<owner>/<app>[/<path>]`, so only a bare id (no `/`) or a legacy short id gets `fal-ai/`.
 */
export const resolveFalEndpointId = (model: string) => {
  const id = model.trim().replaceAll(/^\/+|\/+$/g, '');

  if (!id.includes('/')) return `fal-ai/${id}`;
  if (LEGACY_SHORT_IDS.has(id)) return `fal-ai/${id}`;
  if (LEGACY_SHORT_ID_PREFIXES.some((prefix) => id.startsWith(prefix))) return `fal-ai/${id}`;

  return id;
};

/** fal endpoint for an image request, adding the task path for one-card model families */
export const resolveFalImageEndpoint = (model: string, hasImageUrls: boolean) => {
  const endpoint = resolveFalEndpointId(model);

  if (EDIT_OR_TEXT_TO_IMAGE_FAMILIES.some((family) => family.test(endpoint))) {
    return `${endpoint}/${hasImageUrls ? 'edit' : 'text-to-image'}`;
  }
  if (EDIT_WITH_IMAGES_MODELS.has(endpoint) && hasImageUrls) return `${endpoint}/edit`;

  return endpoint;
};

/** Families billed by output resolution tier, whose `resolution` preset becomes an image size */
export const isFalResolutionTierEndpoint = (endpoint: string) =>
  endpoint.startsWith('alibaba/qwen-image-3/');
