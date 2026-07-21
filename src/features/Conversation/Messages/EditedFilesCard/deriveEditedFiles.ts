import {
  classifyEditedFile,
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
    (block.tools ?? []).map((tool) => ({
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
 * entity-format files (pptx / xlsx / docx / pdf / …) — those surface through the
 * `file` Work system (WorksSection / WorkGallery) instead. HTML (artifact
 * hosting) and every other file stay in the card.
 *
 * Purely derived from the message payload already in the store — nothing is
 * persisted. Callers must memoize on the blocks reference (see
 * {@link useOperationEditedFiles}) so the scan runs once per snapshot.
 */
export const deriveOperationEditedFiles = (
  blocks: AssistantContentBlock[] = [],
): EditedFileEntry[] => {
  const records = collectFileEditToolCallRecords(blocks);
  if (records.length === 0) return [];

  return scanOperationFileEdits(records).filter(
    (entry) => classifyEditedFile(entry.path).category !== 'entity',
  );
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
