import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';
import '@/styles/stylex.css';

import { ARTBOARD_SNAPSHOT_ELEMENT_ID, type ArtboardPublishSnapshot } from '@lobechat/types';
import { createRoot } from 'react-dom/client';

import App from './App';
import { initViewerI18n } from './i18n';
import { initViewerStore } from './viewerState';

const followSystemTheme = () => {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    document.documentElement.dataset.theme = query.matches ? 'dark' : 'light';
  };
  apply();
  query.addEventListener('change', apply);
};

const boot = async () => {
  const data = document.getElementById(ARTBOARD_SNAPSHOT_ELEMENT_ID)?.textContent;
  const root = document.getElementById('root');
  if (!data || !root) return;
  followSystemTheme();
  await initViewerI18n(navigator.language);
  const snapshot = JSON.parse(data) as ArtboardPublishSnapshot;
  initViewerStore(snapshot);
  createRoot(root).render(<App snapshot={snapshot} />);
};

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', () => void boot());
else void boot();
