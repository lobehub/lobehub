import { ProviderCombine, ProviderIcon, providerMappings, Unsloth } from '@lobehub/icons';

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

export { ProviderCombine, ProviderIcon };
