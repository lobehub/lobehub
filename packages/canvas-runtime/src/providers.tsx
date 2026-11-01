import { ConfigProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

// The canvas CSP only allows same-origin fonts, so lobe-ui's CDN webfonts would be blocked.
export const wrapCanvasTree = (children: ReactNode) => (
  <ConfigProvider enableCustomFonts={false} motion={motion}>
    {children}
  </ConfigProvider>
);
