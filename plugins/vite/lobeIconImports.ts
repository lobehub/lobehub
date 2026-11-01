import transformImports from '@rolldown/plugin-transform-imports';
import type { Plugin, PluginOption } from 'vite';

const NAMED_EXPORT_PREFIX = 'virtual:lobe-icon-named:';
const RESOLVED_NAMED_EXPORT_PREFIX = `\0${NAMED_EXPORT_PREFIX}`;

const namedExportModules = {
  agentMappings: '@lobehub/icons/es/features/agentConfig.js',
  getLobeIconCDN: '@lobehub/icons/es/features/getLobeIconCDN/index.js',
  modelMappings: '@lobehub/icons/es/features/modelConfig.js',
  ModelProvider: '@lobehub/icons/es/features/providerEnum.js',
  providerMappings: '@lobehub/icons/es/features/providerConfig.js',
  toc: '@lobehub/icons/es/toc.js',
  useFillId: '@lobehub/icons/es/hooks/useFillId.js',
  useFillIds: '@lobehub/icons/es/hooks/useFillId.js',
} as const;

type NamedExport = keyof typeof namedExportModules;

const isNamedExport = (value: string): value is NamedExport => value in namedExportModules;

const namedExportProxy = (): Plugin => ({
  name: 'lobe-icon-named-export-proxy',
  load(id) {
    if (!id.startsWith(RESOLVED_NAMED_EXPORT_PREFIX)) return;

    const member = id.slice(RESOLVED_NAMED_EXPORT_PREFIX.length);
    if (!isNamedExport(member)) return;

    return `export { ${member} as default } from '${namedExportModules[member]}';`;
  },
  resolveId(id) {
    if (!id.startsWith(NAMED_EXPORT_PREFIX)) return;

    return `\0${id}`;
  },
});

const includeModuleExtensions = (plugin: ReturnType<typeof transformImports>) => {
  if (typeof plugin.transform !== 'object' || !plugin.transform) return plugin;

  plugin.transform = {
    ...plugin.transform,
    filter: {
      ...plugin.transform.filter,
      // @lobehub/ui is published as .mjs and imports @lobehub/icons internally.
      // The upstream plugin currently only includes .js/.jsx/.ts/.tsx by default.
      id: /\.[cm]?[jt]sx?$/,
    },
  };

  return plugin;
};

/**
 * Rewrites the @lobehub/icons barrel to deep imports.
 *
 * The SPA entry and lazy routes otherwise share the same barrel module. Once a
 * lazy route uses ModelIcon or ProviderIcon, their complete mapping tables are
 * promoted into the initial shared chunk even when the first screen only needs
 * a small standalone icon.
 */
export const lobeIconImports = (): PluginOption[] => {
  const iconImports = transformImports({
    '@lobehub/icons': {
      preventFullImport: true,
      transform: [
        [
          'AgentIcon|IconAvatar|IconCombine|ModelIcon|ModelTag|ProviderCombine|ProviderIcon',
          '@lobehub/icons/es/features/{{member}}/index.js',
        ],
        [
          'agentMappings|getLobeIconCDN|modelMappings|ModelProvider|providerMappings|toc|useFillId|useFillIds',
          `${NAMED_EXPORT_PREFIX}{{member}}`,
        ],
        ['*', '@lobehub/icons/es/{{member}}/index.js'],
      ],
    },
  });

  return [namedExportProxy(), includeModuleExtensions(iconImports)];
};

export const __testing = {
  NAMED_EXPORT_PREFIX,
  RESOLVED_NAMED_EXPORT_PREFIX,
  namedExportModules,
};
