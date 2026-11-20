import type { VerifyEvidenceChapter } from '@lobechat/types';

/**
 * Frame rate assumed for stepping. Recordings are assembled at a fixed rate
 * (the acceptance skill uses 30), and the browser exposes no frame rate, so a
 * step moves one 1/30 s tick — close enough to land on each captured frame.
 */
export const VIDEO_FPS = 30;

export { formatVideoTimestamp as formatVideoTime } from '@lobechat/const/verify';

/**
 * Whether a note disputes this exact claim. Two claims can share a frame and a
 * kind, so the quoted text is part of the identity.
 */
export const disputesClaim = (
  disputes: Pick<VerifyEvidenceChapter, 'kind' | 'note' | 't'> | undefined,
  claim: VerifyEvidenceChapter,
) =>
  Boolean(disputes) &&
  disputes!.t === claim.t &&
  disputes!.kind === claim.kind &&
  disputes!.note === claim.note;

/** `m:ss` for chapter chips, where hundredths are noise. */
export const formatVideoClock = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds - minutes * 60)).padStart(2, '0')}`;
};

/**
 * The frame on screen at a time: frame n shows from n/fps until (n+1)/fps.
 * The epsilon absorbs float error at exact frame boundaries.
 */
export const frameOf = (seconds: number) => Math.floor(seconds * VIDEO_FPS + 1e-6);

export const stepsOf = (chapters: VerifyEvidenceChapter[]) =>
  chapters.filter((chapter) => chapter.kind === 'step');

/** What the agent claims (`check`) or disclosed (`flag`) — the parts a reviewer audits. */
export const claimsOf = (chapters: VerifyEvidenceChapter[]) =>
  chapters.filter((chapter) => chapter.kind !== 'step');

/**
 * Whether a region drawn on the frame at `start` belongs on screen. Paused, it
 * shows only on its own frame, so a region never lands on a frame it was not
 * drawn on; playing, it lingers long enough to be seen at all.
 */
export const isOnFrame = (start: number, time: number, paused: boolean) =>
  Math.abs(start - time) <= (paused ? 0.5 / VIDEO_FPS : 0.35);
