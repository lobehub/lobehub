import { useToolStore } from '@/store/tool';

export const useCheckPluginsIsInstalled = (plugins: string[]) => {
  const checkPluginsIsInstalled = useToolStore((s) => s.useCheckPluginsIsInstalled);

  checkPluginsIsInstalled(true, plugins);
};
