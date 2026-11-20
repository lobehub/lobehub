import { z } from 'zod';

import { evidenceCommentDraftSchema } from './evidenceCommentDraft';

const noteSchema = evidenceCommentDraftSchema.extend({
  rect: evidenceCommentDraftSchema.shape.rect.unwrap(),
  time: z.object({ start: z.number().finite().nonnegative() }),
});
const notesSchema = z.array(noteSchema);
export type VideoCommentDraft = z.infer<typeof noteSchema>;

export const readVideoCommentDrafts = (key: string): VideoCommentDraft[] => {
  try {
    return notesSchema.parse(JSON.parse(localStorage.getItem(`${key}:frames`) ?? '[]'));
  } catch {
    return [];
  }
};

export const saveVideoCommentDrafts = (key: string, notes: VideoCommentDraft[]) => {
  try {
    if (notes.length > 0) localStorage.setItem(`${key}:frames`, JSON.stringify(notes));
    else localStorage.removeItem(`${key}:frames`);
  } catch {
    /* Editing and idempotent retry remain available without browser storage. */
  }
};

/**
 * Notes in the order the video plays them, so the numbers on the frame, the
 * timeline and the list count up together. Notes on one frame keep the order
 * they were drawn in.
 */
export const orderVideoCommentDrafts = (notes: VideoCommentDraft[]) =>
  notes.toSorted((a, b) => a.time.start - b.time.start);

/** A successful note is removed immediately; a later failure leaves only unsent notes for retry. */
export const sendVideoCommentDrafts = async (
  notes: VideoCommentDraft[],
  send: (note: VideoCommentDraft) => Promise<boolean>,
  onSent: (id: string) => void,
) => {
  for (const note of notes) {
    if (!(await send({ ...note, content: note.content.trim() }))) return false;
    onSent(note.clientId);
  }
  return true;
};
