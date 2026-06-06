// Kept as a distinct entry only for backwards-compatible import paths. The base
// `EditorRuntime` is isomorphic now that LiteXML commands come from the
// side-effect-free `@lobehub/editor/litexml-commands` subpath, so client and
// server share the exact same implementation.
export { EditorRuntime, type LiteXMLBatchOperation } from './EditorRuntime';
export * from './types';
