import type { EditedFileEntry } from '@lobechat/builtin-tools/fileEditScan';
import type { AssistantContentBlock } from '@lobechat/types';
import { useMemo } from 'react';

import { deriveOperationEditedFiles } from './deriveEditedFiles';

/**
 * Derived, non-persisted list of files edited across one assistant round.
 *
 * Pass the assistant group's `children` blocks — the display selector returns a
 * stable reference across unrelated store ticks (guarded by `isEqual`), so the
 * scan runs once per real message snapshot instead of on every streamed token.
 *
 * The card is a turn-end product, so callers should gate this on generation
 * state and pass `undefined` (→ empty result, no card) while the round is still
 * streaming: `children` is rebuilt on every token during generation, which would
 * otherwise re-run the scan continuously for a card nobody sees until the end.
 *
 * `hasWorkSurface` — whether the round carries a work anchor (server-runtime
 * operation): only then are sandbox-entity edits dropped in favor of their
 * `file` Work card (see {@link deriveOperationEditedFiles}).
 */
export const useOperationEditedFiles = (
  blocks?: AssistantContentBlock[],
  hasWorkSurface?: boolean,
): EditedFileEntry[] =>
  useMemo(() => deriveOperationEditedFiles(blocks ?? [], hasWorkSurface), [blocks, hasWorkSurface]);
