/**
 * DataTransfer MIME type used when dragging a skill chip from the working
 * sidebar into the chat input. A custom (non-`Files`) type so the file-upload
 * drop zone ignores it — it only reacts to `Files`.
 */
export const SKILL_DRAG_MIME = 'application/x-lobe-skill';
