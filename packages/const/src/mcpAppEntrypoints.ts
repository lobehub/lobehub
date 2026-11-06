import { resolveMcpUiToolMeta } from './mcpUiMeta';

export interface McpAppThreadEntry {
  icon?: string;
  title: string;
  toolName: string;
}

interface EntryTool {
  _meta?: unknown;
  annotations?: { title?: string };
  icons?: { src: string }[];
  name: string;
  title?: string;
}

/** Called only with the feature gate; disabled discovery never reads extensions. */
export const getMcpAppEntrypoints = (
  tools: readonly EntryTool[],
  enabled = false,
  serverIcons?: { src: string }[],
): McpAppThreadEntry[] => {
  if (!enabled) return [];
  return tools.flatMap((tool) => {
    const meta = resolveMcpUiToolMeta(tool._meta);
    if (!meta.resourceUri || !meta.entrypoints?.some((entry) => entry.type === 'thread')) return [];
    return [
      {
        icon: tool.icons?.[0]?.src ?? serverIcons?.[0]?.src,
        title: tool.title || tool.annotations?.title || tool.name,
        toolName: tool.name,
      },
    ];
  });
};

/** Live tools/list validation, independent of model/app visibility. */
export const isMcpThreadEntrypoint = (
  meta: ReturnType<typeof resolveMcpUiToolMeta> | undefined,
): boolean => !!meta?.resourceUri && !!meta.entrypoints?.some((entry) => entry.type === 'thread');
