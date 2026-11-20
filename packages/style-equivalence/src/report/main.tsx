import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';
import './report.css';

import { ConfigProvider, setLobeTheme } from '@lobehub/ui';
import { domAnimation, LazyMotion } from 'motion/react';
import * as motion from 'motion/react-m';
import { createRoot } from 'react-dom/client';

import { App } from './ui/App';
import { initialAppearance } from './ui/ThemeToggle';

setLobeTheme({ appearance: initialAppearance() });

createRoot(document.getElementById('root')!).render(
  <LazyMotion features={domAnimation}>
    <ConfigProvider motion={motion}>
      <App />
    </ConfigProvider>
  </LazyMotion>,
);
