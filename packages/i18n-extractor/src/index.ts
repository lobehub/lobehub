export type { I18nExtractCliConfig } from './cli';
export { defineConfig, runCli } from './cli';
export type { DynamicKeyEntry, ExtractTranslationUsesOptions, TranslationUse } from './extract';
export {
  assertBoundedTranslationUses,
  extractTranslationUses,
  i18nextPreset,
  selectKeys,
  typePatterns,
  UNBOUNDED_PATTERN,
} from './extract';
export type {
  Catalog,
  CatalogAdapter,
  ExtractI18nConfig,
  ExtractI18nResult,
  I18nReport,
  Resources,
} from './extractI18n';
export { extractI18n } from './extractI18n';
export type {
  AddWorkspacePathsOptions,
  ImportEdge,
  ImportGraph,
  TraceImportGraphOptions,
} from './graph';
export {
  addWorkspacePaths,
  defaultMustResolve,
  hasDirective,
  isUseClientBoundary,
  listSourceFiles,
  traceImportGraph,
} from './graph';
export type { Namespaced, NamespacedTranslate, NamespaceMarker } from './marker';
export { DEFAULT_NAMESPACE_MARKER } from './marker';
export { renderResourcesModule, writeIfChanged } from './output';
