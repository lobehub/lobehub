import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';
import '@/styles/stylex.css';

import { ConfigProvider } from '@lobehub/ui';
import * as motion from 'motion/react-m';
import type { ReactNode } from 'react';

export const Host = ({ children }: { children: ReactNode }) => (
  <ConfigProvider enableCustomFonts={false} motion={motion}>
    <div style={{ fontFamily: 'Arial, sans-serif' }}>{children}</div>
  </ConfigProvider>
);
