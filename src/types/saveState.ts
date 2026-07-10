/**
 * Canonical save-state contract shared by every write surface (autosave,
 * explicit submit, store save-state maps). The write-side counterpart to the
 * read-side `NormalizedAsyncError` (`libs/swr/normalizeError.ts`).
 *
 * The audit (`ux` feedback.md §4.4) found this union duplicated ~6 times as
 * `'idle' | 'saving' | 'saved'` with **no failure member**, so every `catch`
 * collapsed to `'idle'` and a failed save rendered identically to a clean state
 * ("Latest"). The `failed` member is the fix: the enum can now *represent*
 * failure, so `AutoSaveHint` / `useSaveState` can show an error + Retry and the
 * edited value is never silently lost.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export interface SaveState {
  lastUpdatedTime?: Date | null;
  saveStatus: SaveStatus;
}
