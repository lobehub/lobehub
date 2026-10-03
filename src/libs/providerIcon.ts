/* eslint-disable no-restricted-imports -- the lazy wrapper in @/components/LobeIcons is the only importer */
import {
  ProviderCombine as LobeProviderCombine,
  ProviderIcon as LobeProviderIcon,
  providerMappings,
  Unsloth,
} from '@lobehub/icons';
/* eslint-enable no-restricted-imports */

/**
 * @lobehub/icons 5.18 exports Unsloth but omits its provider mapping. Register
 * the official artwork until the library includes it, preserving an upstream
 * mapping when present. Keep this alongside provider icon consumers so the
 * complete mapping table stays outside the SPA's initial dependency graph.
 */
if (
  !providerMappings.some(({ keywords }) => keywords.some((key) => key.toLowerCase() === 'unsloth'))
) {
  providerMappings.push({ Icon: Unsloth, keywords: ['unsloth'] });
}

// Do not turn these back into `export { ... }` re-exports: with rolldown's
// strictExecutionOrder (rolldown 1.2.12) the icon modules' init wrappers are
// then never called in production chunks, both exports stay undefined and the
// lazy loaders in @/components/LobeIcons crash with React #306.
export const ProviderIcon = LobeProviderIcon;
export const ProviderCombine = LobeProviderCombine;
