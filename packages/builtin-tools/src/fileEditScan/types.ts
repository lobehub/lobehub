/**
 * Shared types for the per-operation file-edit scanner.
 *
 * They describe the minimal, duck-typed shape of ONE persisted tool call as
 * seen by BOTH consumers, so the same scanner can run on either side:
 * - server: one `message_plugins` row (its `apiName` / `arguments` /
 *   `identifier` / `state` / `toolCallId` columns).
 * - client: one tool payload held in the chat store (same fields).
 *
 * The scanner reads `state` / `arguments` structurally (duck-typed) and never
 * imports `@lobechat/tool-runtime` or `@lobechat/heterogeneous-agents`, so this
 * module stays dependency-light and safe for both bundles.
 */

/** One persisted tool call within an operation. */
export interface FileEditToolCallRecord {
  apiName: string;
  /** Raw JSON string of tool arguments. */
  arguments?: string | null;
  /**
   * Tool-result error, when the call failed at the plugin layer (server:
   * `message_plugins.error`; client: `tool.result?.error`). A non-empty value
   * means the edit never landed, so the scanner skips the whole record — this
   * is the plugin-level counterpart to a `state`-reported failure.
   */
  error?: unknown;
  /** Plugin/tool identifier, e.g. 'lobe-cloud-sandbox'. */
  identifier?: string | null;
  /** Persisted plugin state (tool result state). */
  state?: unknown;
  toolCallId: string;
}

export type EditedFileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

/** Terminal-state summary of all edits to one file within an operation. */
export interface EditedFileEntry {
  /** Chronological per-edit diffs, only for source tools that provided one. */
  diffTexts: string[];
  /** Folded terminal change kind after replaying every edit to this path. */
  kind: EditedFileChangeKind;
  linesAdded: number;
  linesDeleted: number;
  /** Current (final) path of the file. */
  path: string;
  /** Original path before a rename; set only when `kind === 'renamed'`. */
  previousPath?: string;
  /** Tool call ids that touched this file, in chronological order. */
  sourceToolCallIds: string[];
}

/**
 * Classification of an edited file's path:
 * - `entity`: an entity-format document that gets its own Work (slides / sheet /
 *   doc / pdf).
 * - `html`: an HTML file (rendered by the artifact-hosting path).
 * - `other`: everything else — folded into the "edited N files" aggregate card.
 */
export type EditedFileCategory =
  | { category: 'entity'; entityKind: 'slides' | 'sheet' | 'doc' | 'pdf' }
  | { category: 'html' }
  | { category: 'other' };
