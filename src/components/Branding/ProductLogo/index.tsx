'use client';

import { type LobeHubProps } from '@lobehub/ui/brand';
import { memo } from 'react';

import CustomLogo from './Custom';

interface ProductLogoProps extends LobeHubProps {
  height?: number;
  width?: number;
}

export const ProductLogo = memo<ProductLogoProps>((props) => {
  return <CustomLogo {...props} />;
});
