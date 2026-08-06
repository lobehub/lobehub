'use client';

import { ModelTag } from '@lobehub/icons';
import { type ModelTagProps } from '@lobehub/icons';
import { Tag } from '@lobehub/ui';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding/ProductLogo';

import { formatBrandedModelId, isBrandedOpenRouterModelId } from './brandedModelId';

/**
 * ModelTag that swaps OpenRouter-namespace models to the product favicon +
 * branding-slug id when custom branding is on.
 */
export const BrandedModelTag = memo<ModelTagProps>(({ model, type = 'mono', ...rest }) => {
  if (isBrandedOpenRouterModelId(model)) {
    return (
      <Tag icon={<ProductLogo size={14} type={type === 'mono' ? 'mono' : 'flat'} />} {...rest}>
        {formatBrandedModelId(model)}
      </Tag>
    );
  }

  return <ModelTag model={model} type={type} {...rest} />;
});

BrandedModelTag.displayName = 'BrandedModelTag';
