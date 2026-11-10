import type { TFunction } from 'i18next';

interface MCPPreviewManifest {
  api: readonly unknown[];
  prompts?: readonly unknown[];
  resources?: readonly unknown[];
}

/** Capability summaries are presentation, not persisted server descriptions. */
export const getMcpManifestSummary = (
  manifest: MCPPreviewManifest,
  t: TFunction<'plugin'>,
  locale?: string,
): string => {
  const capabilities: string[] = [];

  if (manifest.prompts?.length)
    capabilities.push(t('dev.preview.mcp.prompts', { count: manifest.prompts.length }));
  if (manifest.resources?.length)
    capabilities.push(t('dev.preview.mcp.resources', { count: manifest.resources.length }));
  if (manifest.api.length)
    capabilities.push(t('dev.preview.mcp.tools', { count: manifest.api.length }));

  return capabilities.length
    ? new Intl.ListFormat(locale).format(capabilities)
    : t('dev.preview.mcp.empty');
};
