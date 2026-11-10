import { ActionIcon, setLobeTheme } from '@lobehub/ui';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';

type Appearance = 'dark' | 'light';

const STORAGE_KEY = 'style-eq:appearance';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const stored = (): Appearance | undefined => {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'dark' || value === 'light' ? value : undefined;
};

const systemAppearance = (): Appearance => (matchMedia(DARK_QUERY).matches ? 'dark' : 'light');

export const initialAppearance = () => stored() ?? systemAppearance();

const subscribeSystem = (listener: () => void) => {
  const media = matchMedia(DARK_QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

export const ThemeToggle = () => {
  const system = useSyncExternalStore(subscribeSystem, systemAppearance);
  const [chosen, setChosen] = useState(stored);
  const appearance = chosen ?? system;
  useEffect(() => setLobeTheme({ appearance }), [appearance]);
  const next = appearance === 'dark' ? 'light' : 'dark';
  return (
    <ActionIcon
      icon={appearance === 'dark' ? Moon : Sun}
      size="small"
      title={next === 'dark' ? '切换到暗色' : '切换到亮色'}
      onClick={() => {
        localStorage.setItem(STORAGE_KEY, next);
        setChosen(next);
      }}
    />
  );
};
