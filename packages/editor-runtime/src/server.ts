// Server-safe entry: re-exports the bare EditorRuntime base. Callers must
// supply their own LiteXMLAdapter (e.g. backed by `HeadlessEditor`) via
// `setLiteXMLAdapter` before invoking `modifyNodes` / `replaceText`.
//
// This entry deliberately does NOT static-import `@lobehub/editor` —
// that bundle evaluates `document.createElement` at module top level
// (ReactSlashPlugin) and crashes Node.
export { EditorRuntime, type LiteXMLAdapter, type LiteXMLBatchOperation } from './EditorRuntime';
export * from './types';
