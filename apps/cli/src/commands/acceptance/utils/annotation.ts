import { formatVideoTimestamp, isFullFrameRect } from '@lobechat/const/verify';

/** A region a reviewer circled on one evidence image, or on one video frame or span. */
export interface ReviewAnnotationRegion {
  comment?: string;
  /** The agent chapter the reviewer disagrees with. */
  disputes?: { kind?: string; note?: string; t?: number };
  evidenceId?: string;
  rect?: { height?: number; width?: number; x?: number; y?: number };
  time?: { end?: number; start?: number };
}

/** `m:ss.cc` — shared with the acceptance page so both read the same moment. */
export const formatVideoTime = formatVideoTimestamp;

const isSeconds = (value?: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const asPercent = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : undefined;

/**
 * Where a review annotation points, rendered for a terminal.
 *
 * The comment alone is not enough to act on: a screenshot usually has several
 * plausible targets, and without the image and the rect the reader has to guess
 * which one was circled. `rect` is normalized to the image box (0–1), so it is
 * printed as percentages. On a video the frame or span comes first, since the
 * reader has to seek there before any region means anything.
 *
 * Returns `undefined` when the annotation carries no location at all — an older
 * review, or one made before regions existed.
 */
export function formatAnnotationRegion(
  annotation: ReviewAnnotationRegion,
  evidenceLabels?: Map<string, string>,
): string | undefined {
  const label = annotation.evidenceId
    ? (evidenceLabels?.get(annotation.evidenceId) ?? annotation.evidenceId)
    : undefined;

  const { rect, time } = annotation;
  let moment: string | undefined;
  if (isSeconds(time?.start))
    moment = isSeconds(time.end)
      ? `${formatVideoTime(time.start)}–${formatVideoTime(time.end)}`
      : `frame at ${formatVideoTime(time.start)}`;
  // A video note that marks a moment without circling an area spans the whole
  // frame; printing "0%,0% · 100%×100%" would read as a real region.
  const wholeFrame =
    moment !== undefined &&
    rect !== undefined &&
    isFullFrameRect({
      height: rect.height ?? 0,
      width: rect.width ?? 0,
      x: rect.x ?? -1,
      y: rect.y ?? -1,
    });

  const x = asPercent(rect?.x);
  const y = asPercent(rect?.y);
  const width = asPercent(rect?.width);
  const height = asPercent(rect?.height);
  const at = x && y ? `${x},${y}` : undefined;
  const size = width && height ? `${width}×${height}` : undefined;
  const position = [moment, wholeFrame ? undefined : at, wholeFrame ? undefined : size]
    .filter(Boolean)
    .join(' · ');

  if (!label && !position) return undefined;
  if (!position) return label;
  return label ? `${label} @ ${position}` : position;
}

/**
 * The agent's own claim a reviewer objected to, quoted back so the repair run
 * sees exactly which of its statements was judged wrong.
 */
export function formatDisputedChapter(disputes?: ReviewAnnotationRegion['disputes']) {
  if (!disputes?.note) return undefined;
  const at = isSeconds(disputes.t) ? ` at ${formatVideoTime(disputes.t)}` : '';
  return `your ${disputes.kind ?? 'claim'}${at}: "${disputes.note}"`;
}
