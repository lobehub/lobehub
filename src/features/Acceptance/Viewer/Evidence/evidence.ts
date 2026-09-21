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
