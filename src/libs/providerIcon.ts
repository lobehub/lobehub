import { isBrandedProviderId } from '@lobechat/const/errorBranding';
/* eslint-disable no-restricted-imports -- the lazy wrapper in @/components/LobeIcons is the only importer */
import {
  ProviderCombine as LobeProviderCombine,
  ProviderIcon as LobeProviderIcon,
  providerMappings,
  Unsloth,
} from '@lobehub/icons';
/* eslint-enable no-restricted-imports */
import { type ComponentProps, createElement } from 'react';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { isCustomBranding } from '@/const/version';

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

// Stored provider IDs remain unchanged in private deployments. Apply branding
// at the shared resolver, including error cards and combined wordmarks, rather
// than requiring every consumer to remember a separate branded component.
const isBrandedProvider = (provider?: string) => isCustomBranding && isBrandedProviderId(provider);

// Do not turn these back into `export { ... }` re-exports: with rolldown's
// strictExecutionOrder (rolldown 1.2.12) the icon modules' init wrappers are
// then never called in production chunks, both exports stay undefined and the
// lazy loaders in @/components/LobeIcons crash with React #306.
export const ProviderIcon = (props: ComponentProps<typeof LobeProviderIcon>) => {
  if (!isBrandedProvider(props.provider)) return createElement(LobeProviderIcon, props);

  const { className, forceMono, size = 24, style, type } = props;
  return createElement(ProductLogo, {
    className,
    size,
    style,
    type: type?.startsWith('combine') ? 'combine' : forceMono || type === 'mono' ? 'mono' : 'flat',
  });
};

export const ProviderCombine = (props: ComponentProps<typeof LobeProviderCombine>) => {
  if (!isBrandedProvider(props.provider)) return createElement(LobeProviderCombine, props);

  const { provider: _provider, size = 24, type: _type, ...rest } = props;
  return createElement(ProductLogo, { ...rest, size, type: 'combine' });
};
