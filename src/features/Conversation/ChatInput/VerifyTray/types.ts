/**
 * A single topic-scoped acceptance criterion authored in the tray.
 *
 * This is a client-side draft of the delivery contract for the active topic.
 * `method` is how the item is judged (stable across turns); the per-round
 * result is not part of the draft — it is produced by a real verify run and
 * hydrated separately once the backend topic-verify path lands.
 *
 * Every item is judged by the verify agent for now; a program/deterministic
 * mode is deferred until its authoring UX is designed.
 */
export interface TrayCheck {
  id: string;
  /** How the item is judged, in the user's words (optional). */
  method: string;
  /** The acceptance criterion itself. */
  name: string;
}
