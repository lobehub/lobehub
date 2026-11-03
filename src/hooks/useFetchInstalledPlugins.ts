import { useToolStore } from '@/store/tool';

export const useFetchInstalledPlugins = () => {
  const [useFetchInstalledPlugins] = useToolStore((s) => [s.useFetchInstalledPlugins]);

  return useFetchInstalledPlugins(true);
};
