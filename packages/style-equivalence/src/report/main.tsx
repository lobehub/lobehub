import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';
import './report.css';

import { ConfigProvider } from '@lobehub/ui';
import * as motion from 'motion/react-m';
import { createRoot } from 'react-dom/client';

import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <ConfigProvider motion={motion}>
    <App />
  </ConfigProvider>,
);
