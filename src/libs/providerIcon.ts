/* eslint-disable eslint-core/no-restricted-imports -- the lazy wrapper in @/components/LobeIcons is the only importer */
import {
  LiveKit,
  ProviderCombine as LobeProviderCombine,
  ProviderIcon as LobeProviderIcon,
  providerMappings,
} from '@lobehub/icons';

/* eslint-enable eslint-core/no-restricted-imports */

// The installed icon package includes LiveKit artwork but no provider-ID mapping.
// Keep this near the lazy consumers; remove when the upstream mapping ships.
if (!providerMappings.some((item) => item.keywords.includes('livekit'))) {
  providerMappings.push({ Icon: LiveKit, keywords: ['livekit'] });
}

// Do not turn these back into `export { ... }` re-exports: with rolldown's
// strictExecutionOrder (rolldown 1.2.12) the icon modules' init wrappers are
// then never called in production chunks, both exports stay undefined and the
// lazy loaders in @/components/LobeIcons crash with React #306.
export const ProviderIcon = LobeProviderIcon;
export const ProviderCombine = LobeProviderCombine;
