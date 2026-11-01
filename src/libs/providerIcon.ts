/* eslint-disable no-restricted-imports -- the lazy wrapper in @/components/LobeIcons is the only importer */
import {
  ProviderCombine as LobeProviderCombine,
  ProviderIcon as LobeProviderIcon,
} from '@lobehub/icons';
/* eslint-enable no-restricted-imports */

// Do not turn these back into `export { ... }` re-exports: with rolldown's
// strictExecutionOrder (rolldown 1.2.12) the icon modules' init wrappers are
// then never called in production chunks, both exports stay undefined and the
// lazy loaders in @/components/LobeIcons crash with React #306.
export const ProviderIcon = LobeProviderIcon;
export const ProviderCombine = LobeProviderCombine;
