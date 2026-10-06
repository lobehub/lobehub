import type { AcceptanceCheck, AcceptanceEvidence } from '../Checks/types';

export const IMAGE_EVIDENCE = new Set(['gif', 'screenshot']);
/** Rendered by a `<video>` / `<audio>` element rather than an image box. */
const PLAYER_EVIDENCE = new Set(['audio', 'video']);
/** Everything that shows or plays inline — the deliverable itself, not a log about it. */
const MEDIA_EVIDENCE = new Set([...IMAGE_EVIDENCE, ...PLAYER_EVIDENCE]);
const ANNOTATABLE_EVIDENCE = IMAGE_EVIDENCE;

export const isVisual = (item: AcceptanceEvidence) =>
  Boolean(item.fileUrl) && MEDIA_EVIDENCE.has(item.type);

export const hasVisualEvidence = (check: AcceptanceCheck) => check.evidence.some(isVisual);

export const isAnnotatable = (item: AcceptanceEvidence) =>
  Boolean(item.fileUrl) && ANNOTATABLE_EVIDENCE.has(item.type);

export const hasAnnotatableEvidence = (check: AcceptanceCheck) =>
  check.evidence.some(isAnnotatable);

/**
 * What a reject can point into: images by region, videos by frame or span.
 * Discussion threads stay image-only ({@link isAnnotatable}) — their anchor has
 * no time yet.
 */
export const isRejectable = (item: AcceptanceEvidence) =>
  isAnnotatable(item) || (Boolean(item.fileUrl) && item.type === 'video');

export const hasRejectableEvidence = (check: AcceptanceCheck) => check.evidence.some(isRejectable);

/**
 * Whether the reject modal has anything to mark on this device: phones review
 * images only (the frame-anchored video stage is desktop-only), so a
 * video-only check offers no marking entry there.
 */
export const canMarkEvidence = (check: AcceptanceCheck, desktop: boolean) =>
  desktop ? hasRejectableEvidence(check) : hasAnnotatableEvidence(check);

export const evidenceCounts = (evidence: AcceptanceEvidence[]) => {
  const counts = { audio: 0, file: 0, image: 0, video: 0 };
  for (const item of evidence) {
    if (item.type === 'video' && item.fileUrl) counts.video += 1;
    else if (item.type === 'audio' && item.fileUrl) counts.audio += 1;
    else if (isVisual(item)) counts.image += 1;
    else counts.file += 1;
  }
  return counts;
};

export const imageRatio = (item: AcceptanceEvidence): string | undefined =>
  item.fileWidth && item.fileHeight ? `${item.fileWidth} / ${item.fileHeight}` : undefined;

/**
 * What the shortcut floating on each picture opens. A reader comments on a
 * region; the author, who gives region feedback through the reject, marks one.
 * Where tapping the picture already opens that marking (a reviewer's phone),
 * a second control for the same thing is left out.
 */
export const evidenceShortcut = ({
  canComment,
  canMark,
  tapMarks,
}: {
  canComment: boolean;
  canMark: boolean;
  tapMarks: boolean;
}): 'annotate' | 'comment' | undefined => {
  if (canComment) return 'comment';
  if (canMark && !tapMarks) return 'annotate';
  return undefined;
};
