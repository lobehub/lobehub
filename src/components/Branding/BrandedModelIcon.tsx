'use client';

import { ModelIcon } from '@lobehub/icons';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding/ProductLogo';

import { isBrandedOpenRouterModelId } from './brandedModelId';

type BrandedModelIconProps = {
  model: string;
  size?: number;
  type?: 'mono' | 'color' | 'avatar';
};

/**
 * Model avatar that swaps OpenRouter-namespace models (`openrouter/...`)
 * to the product favicon when custom branding is on.
 */
export const BrandedModelIcon = memo<BrandedModelIconProps>(({ model, size = 32, type }) => {
  if (isBrandedOpenRouterModelId(model)) {
    return <ProductLogo size={size} type={type === 'mono' ? 'mono' : 'flat'} />;
  }

  return <ModelIcon model={model} size={size} type={type} />;
});

BrandedModelIcon.displayName = 'BrandedModelIcon';
