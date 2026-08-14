/**
 * DataTransfer MIME type used when dragging a thread row into the conversation
 * area to open it side-by-side in the portal. A custom type keeps Lexical (and
 * the topic drop handler) from mistaking the payload for a dropped topic/text.
 */
export const THREAD_DRAG_MIME = 'application/x-lobe-thread';
