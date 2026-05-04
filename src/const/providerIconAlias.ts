/**
 * Provider Icon Alias Mapping
 *
 * Maps provider IDs that are not yet supported by @lobehub/icons to existing brand icons.
 * After upgrading @lobehub/icons, check if mappings can be removed.
 *
 * Current mappings:
 * - stepfuncodingplan → stepfun: Step Plan is a Coding Plan product of Stepfun, reuses the Stepfun brand icon
 */
export const PROVIDER_ICON_ALIAS: Record<string, string> = {
  stepfuncodingplan: 'stepfun',
};
