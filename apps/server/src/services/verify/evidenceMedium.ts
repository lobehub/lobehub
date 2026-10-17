import type { VerifyEvidenceType } from '@lobechat/types';

/** The stored-file fields that reveal what an artifact actually is. */
export interface EvidenceFileShape {
  fileType?: string | null;
  name?: string | null;
}

const isGifFile = (file: EvidenceFileShape): boolean =>
  file.fileType?.toLowerCase() === 'image/gif' || /\.gif$/i.test(file.name ?? '');

/**
 * The evidence type a file-backed artifact is stored under. The caller's label
 * is a claim; the file is the fact. Builders whose tools offered no `gif` type
 * uploaded their GIFs as `video` or `screenshot`: the acceptance page then
 * played an animated image in a video player that could only show a load
 * failure, and the coverage gate counted it as the wrong medium. A GIF file is
 * an animated image whatever it was labelled, so it is stored as `gif`.
 */
export const evidenceTypeForStoredFile = (
  declared: VerifyEvidenceType,
  file: EvidenceFileShape | null | undefined,
): VerifyEvidenceType => {
  if (!file) return declared;
  if ((declared === 'video' || declared === 'screenshot') && isGifFile(file)) return 'gif';
  return declared;
};
