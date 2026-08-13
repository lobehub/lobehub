'use client';

import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { type ProviderIconProps } from '@lobehub/icons';
import { ProviderIcon as VendorProviderIcon } from '@lobehub/icons';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { isCustomBranding } from '@/const/version';

/**
 * `ProviderIcon` keyed by provider id, except that the id this distribution
 * serves as its own resolves to the product logo instead of to LobeHub's mark.
 *
 * The branded provider keeps the upstream id in the catalogue and therefore in
 * every spend row and usage aggregate, so an unqualified `<ProviderIcon />`
 * renders the LobeHub logo beside our own product name — the one place in the
 * app still visibly attributing the models to someone else. The provider list
 * and the model picker already make this substitution inline; this is the same
 * one, for the surfaces that render a provider id straight from stored usage
 * data.
 *
 * Falls through to the vendor icon for every other provider, and for upstream
 * builds, where the two render the same logo anyway.
 */
export const ProviderIcon = memo<ProviderIconProps>(({ provider, size, style, ...rest }) =>
  isCustomBranding && provider === BRANDING_PROVIDER ? (
    <ProductLogo size={size} style={style} type={'flat'} />
  ) : (
    <VendorProviderIcon provider={provider} size={size} style={style} {...rest} />
  ),
);
