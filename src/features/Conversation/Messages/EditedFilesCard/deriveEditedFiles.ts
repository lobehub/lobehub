import {
  classifyEditedFile,
  CLOUD_SANDBOX_IDENTIFIER,
  type EditedFileEntry,
  type FileEditToolCallRecord,
  scanOperationFileEdits,
} from '@lobechat/builtin-tools/fileEditScan';
import type { AssistantContentBlock } from '@lobechat/types';

/**
 * Map the display-layer tool payloads of one assistant round into the shared
 * scanner's record shape. Each `block.tools` entry is a
 * `ChatToolPayloadWithResult`, so its persisted `pluginState` is surfaced at
 * `tool.result.state` (see `FlatListBuilder.createAssistantGroupMessage`) — the
 * exact `state` the scanner reads for sandbox / codex / claude-code edits.
 */
export const collectFileEditToolCallRecords = (
  blocks: AssistantContentBlock[] = [],
): FileEditToolCallRecord[] =>
  blocks.flatMap((block) =>
    (block.tools ?? [])
      // A tool call with NO merged result never executed (still pending human
      // approval, or the run was interrupted first) — FlatListBuilder only
      // attaches `result` once a tool message exists. Without this guard the
      // scanner would fall back to `arguments.path` for sandbox write/edit
      // calls and show a file as edited that was never actually written.
      .filter((tool) => tool.result != null)
      .map((tool) => ({
        apiName: tool.apiName,
        arguments: tool.arguments,
        // A failed tool call surfaces its error on the merged result, mirroring
        // the server's `message_plugins.error`; the scanner skips such records.
        error: tool.result?.error,
        identifier: tool.identifier,
        state: tool.result?.state,
        toolCallId: tool.id,
      })),
  );

/**
 * Derive the aggregated edited-file entries for one operation's "edited N files"
 * card. Scans every tool call in the assistant group's blocks, then drops
 * entity-format files (pptx / xlsx / docx / pdf / …) whose last edit is
 * sandbox-backed — those surface through the `file` Work system (WorksSection /
 * WorkGallery) instead. An entity file last edited by a hetero source (codex /
 * claude-code / lobe-local-system / device-routed lobe-skills commands, including
 * entities detected from shell command text) registers NO file Work (registration
 * only exports from the cloud sandbox, see server `fileWorkRegistration`), so it
 * stays in the card — the only place it remains visible. HTML (artifact hosting) and every other file stay in the card
 * too.
 *
 * The sandbox-entity drop only applies when `hasWorkSurface` is true — i.e. the
 * round carries a work anchor (server-runtime operation), so a `file` Work can
 * actually exist. Legacy client-runtime rounds have no work registration; for
 * them the drop would make the file invisible on BOTH surfaces, so entries are
 * kept in the card instead.
 *
 * Purely derived from the message payload already in the store — nothing is
 * persisted. Callers must memoize on the blocks reference (see
 * {@link useOperationEditedFiles}) so the scan runs once per snapshot.
 */
export const deriveOperationEditedFiles = (
  blocks: AssistantContentBlock[] = [],
  hasWorkSurface = false,
): EditedFileEntry[] => {
  const records = collectFileEditToolCallRecords(blocks);
  if (records.length === 0) return [];

  const entries = scanOperationFileEdits(records);
  if (!hasWorkSurface) return entries;

  const sandboxToolCallIds = new Set(
    records
      .filter((record) => record.identifier === CLOUD_SANDBOX_IDENTIFIER)
      .map((record) => record.toolCallId),
  );

  return entries.filter((entry) => {
    if (classifyEditedFile(entry.path).category !== 'entity') return true;
    // Mirrors the server's provenance rule: a Work version's provenance is the
    // file's LAST edit, so the card drops the entry only when that edit came
    // from the sandbox (→ a Work card covers it).
    const lastSourceToolCallId = entry.sourceToolCallIds.at(-1);
    return !(lastSourceToolCallId && sandboxToolCallIds.has(lastSourceToolCallId));
  });
};

export interface EditedFilesTotals {
  linesAdded: number;
  linesDeleted: number;
}

/** Sum the per-file line deltas for the card's git-diff-stat style header. */
export const summarizeEditedFilesTotals = (entries: EditedFileEntry[]): EditedFilesTotals =>
  entries.reduce<EditedFilesTotals>(
    (totals, entry) => ({
      linesAdded: totals.linesAdded + entry.linesAdded,
      linesDeleted: totals.linesDeleted + entry.linesDeleted,
    }),
    { linesAdded: 0, linesDeleted: 0 },
  );
