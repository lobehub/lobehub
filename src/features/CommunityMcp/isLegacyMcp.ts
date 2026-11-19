import type { InstallPluginMeta } from '@/types/tool/plugin';

export const isLegacyMcp = ({
  runtimeType,
  type,
}: Pick<InstallPluginMeta, 'runtimeType' | 'type'>) =>
  runtimeType === 'mcp' && (type === 'plugin' || type === 'customPlugin');
