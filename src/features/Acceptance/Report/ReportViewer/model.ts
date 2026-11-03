import type { VerifyEvidenceType } from '@lobechat/types';
import type { TFunction } from 'i18next';

import type { VerifyEvidenceWithUrl } from '@/services/verify';

import { type EvidenceComparisonMeta, readEvidenceComparison } from '../EvidenceComparisonCard';
import { filenameFromUrl } from '../MarkdownEvidence';

export const imageEvidenceTypes = new Set(['gif', 'screenshot']);
/** Player media — a `<video>`/`<audio>` element, not an image box. */
const playerEvidenceTypes = new Set(['audio', 'video']);
/** Media that renders/plays inline in the check body, no click-to-open. */
export const isInlineVisualEvidence = (evidence: VerifyEvidenceWithUrl) =>
  Boolean(
    evidence.fileUrl &&
    (imageEvidenceTypes.has(evidence.type) || playerEvidenceTypes.has(evidence.type)),
  );

/**
 * A command execution folds itself to one row and loads its output files on
 * demand, so it sits in the check body whether its transcript is inline or a
 * file — never behind the generic file card that would open it as a document.
 */
export const isTerminalEvidence = (evidence: VerifyEvidenceWithUrl) => evidence.type === 'terminal';

/**
 * Evidence with a directly renderable payload in the check body, no
 * click-to-open. File-backed documents stay behind the file card on purpose —
 * an uploaded artifact is long by definition, and rendering it inline drowns
 * the check list.
 */
export const isInlineEvidence = (evidence: VerifyEvidenceWithUrl) =>
  Boolean(evidence.content) || isInlineVisualEvidence(evidence) || isTerminalEvidence(evidence);

/** Coarse attachment bucket for the type marker: image / video / audio / everything else. */
export type EvidenceCategory = 'audio' | 'file' | 'image' | 'video';
export const evidenceCategory = (type: VerifyEvidenceType): EvidenceCategory =>
  type === 'video'
    ? 'video'
    : type === 'audio'
      ? 'audio'
      : imageEvidenceTypes.has(type)
        ? 'image'
        : 'file';
export const evidenceDisplayName = (
  evidence: VerifyEvidenceWithUrl,
  t: TFunction<'verify'>,
  index: number,
) =>
  evidence.fileName ||
  (evidence.fileUrl ? filenameFromUrl(evidence.fileUrl) : '') ||
  evidence.description ||
  t('report.evidence.inlineFallback', { index });

type EvidenceComparison = EvidenceComparisonMeta;

export const evidenceComparison = (evidence: VerifyEvidenceWithUrl): EvidenceComparison | null => {
  // Inline media pairs, and so do two runs of one command; a plain text
  // artifact can't sit in a visual diptych.
  if (!isInlineVisualEvidence(evidence) && !isTerminalEvidence(evidence)) return null;
  return readEvidenceComparison(evidence.metadata);
};
