import { isFullFrameRect } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation } from '@lobechat/types';

// Regions are normalized 0-1; percentages read better to a model than raw floats.
const pct = (value: number) => `${Math.round(value * 100)}%`;

const seconds = (value: number) => `${Number(value.toFixed(2))}s`;

/**
 * One reviewer annotation as a prompt line: where it points (image frame label,
 * video moment, circled region) and what the reviewer said about it.
 *
 * Video frames are never attached to these prompts, so a video note keeps its
 * moment and the reviewer's words but not a region: coordinates on a picture
 * the model cannot see would invite it to imagine what was circled.
 */
export const renderAnnotationRegion = (annotation: AcceptanceReviewAnnotation, frame?: string) => {
  const { disputes, rect, time } = annotation;
  let when = '';
  if (time)
    when =
      time.end === undefined
        ? ` at ${seconds(time.start)} into the video`
        : ` from ${seconds(time.start)} to ${seconds(time.end)} of the video`;
  let at = '';
  if (time && !frame) at = ' (video frame not attached — judge from the note alone)';
  // A video note over the whole frame marks a moment, not an area.
  else if (rect && !(time && isFullFrameRect(rect)))
    at = ` at ${pct(rect.x)},${pct(rect.y)} sized ${pct(rect.width)}×${pct(rect.height)}`;
  const disputed = disputes?.note
    ? ` (disputing the agent's ${disputes.kind}: "${disputes.note}")`
    : '';
  return `  ${time ? 'marked' : 'circled'}${frame ? ` on ${frame}` : ''}${when}${at}${disputed}: ${annotation.comment?.trim() || '(no note)'}`;
};
