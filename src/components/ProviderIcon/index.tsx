import {
  ProviderCombine as LobeProviderCombine,
  type ProviderCombineProps,
  ProviderIcon as LobeProviderIcon,
  type ProviderIconProps,
} from '@lobehub/icons';

import { PROVIDER_ICON_ALIAS } from '@/const/providerIconAlias';

function resolveProviderId(id: string | undefined): string {
  if (!id) return '';
  return PROVIDER_ICON_ALIAS[id.toLowerCase()] ?? id;
}

/**
 * Wrapper for @lobehub/icons ProviderIcon with automatic provider ID aliasing.
 *
 * Use this component instead of the raw @lobehub/icons ProviderIcon
 * when rendering dynamic provider IDs that may not have icons yet.
 */
export const ProviderIcon = (props: ProviderIconProps) => (
  <LobeProviderIcon {...props} provider={resolveProviderId(props.provider)} />
);

/**
 * Wrapper for @lobehub/icons ProviderCombine with automatic provider ID aliasing.
 *
 * Use this component instead of the raw @lobehub/icons ProviderCombine
 * when rendering dynamic provider IDs that may not have icons yet.
 */
export const ProviderCombine = (props: ProviderCombineProps) => (
  <LobeProviderCombine {...props} provider={resolveProviderId(props.provider)} />
);
