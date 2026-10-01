import type { VerifyEvidenceChapter } from '@lobechat/types';

/**
 * Frame rate assumed for stepping. Recordings are assembled at a fixed rate
 * (the acceptance skill uses 30), and the browser exposes no frame rate, so a
 * step moves one 1/30 s tick — close enough to land on each captured frame.
 */
export const VIDEO_FPS = 30;

export const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;

/** How long a claim stays on screen after its frame, like a subtitle. */
export const CLAIM_CAPTION_SECONDS = 2;

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

/**
 * The time to seek to for a frame step. It lands on frame centres, so
 * repeated steps never skip a frame or show the same one twice.
 */
export const steppedTime = (current: number, frames: number, duration: number) =>
  Math.min(Math.max((frameOf(current) + frames + 0.5) / VIDEO_FPS, 0), duration);

export const stepsOf = (chapters: VerifyEvidenceChapter[]) =>
  chapters.filter((chapter) => chapter.kind === 'step');

/** What the agent claims (`check`) or disclosed (`flag`) — the parts a reviewer audits. */
export const claimsOf = (chapters: VerifyEvidenceChapter[]) =>
  chapters.filter((chapter) => chapter.kind !== 'step');

/** The step the playhead is in, for the "frame 210 · Scroll #3" readout. */
export const stepAt = (chapters: VerifyEvidenceChapter[], time: number) =>
  stepsOf(chapters).findLast((chapter) => chapter.t <= time + 0.01);

/** The claim to caption at this time: from its frame until it has been read. */
export const claimAt = (chapters: VerifyEvidenceChapter[], time: number) =>
  claimsOf(chapters)
    .filter(
      (chapter) => time >= chapter.t - 0.5 / VIDEO_FPS && time < chapter.t + CLAIM_CAPTION_SECONDS,
    )
    // The most recent claim wins, whatever order the chapters arrived in.
    .reduce<VerifyEvidenceChapter | undefined>(
      (latest, chapter) => (!latest || chapter.t >= latest.t ? chapter : latest),
      undefined,
    );

/**
 * Every claim on the frame being captioned. Two claims can share a frame; the
 * caption is where each one is read and disputed, so none may hide behind
 * another.
 */
export const claimsAt = (chapters: VerifyEvidenceChapter[], time: number) => {
  const latest = claimAt(chapters, time);
  return latest ? claimsOf(chapters).filter((chapter) => chapter.t === latest.t) : [];
};

/**
 * Whether a region drawn on the frame at `start` belongs on screen. Paused, it
 * shows only on its own frame, so a region never lands on a frame it was not
 * drawn on; playing, it lingers long enough to be seen at all.
 */
export const isOnFrame = (start: number, time: number, paused: boolean) =>
  Math.abs(start - time) <= (paused ? 0.5 / VIDEO_FPS : 0.35);
