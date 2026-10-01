import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useVideoClock } from './useVideoClock';

type FrameCallback = (now: number, frame: { mediaTime: number }) => void;

/**
 * Just enough of a `<video>` for the clock: the media clock (`currentTime`)
 * and the painted frame are separate, and `pause` is delivered as an event
 * after the call returns — exactly the two facts the clock has to reconcile.
 */
class FakeVideo extends EventTarget {
  currentTime = 0;
  duration = 15;
  paused = false;
  playbackRate = 1;
  readyState = 1;
  videoHeight = 720;
  videoWidth = 1280;
  private frameCallback?: FrameCallback;

  requestVideoFrameCallback(callback: FrameCallback) {
    this.frameCallback = callback;
    return 1;
  }

  cancelVideoFrameCallback() {}

  /** The browser paints a frame, then its media clock keeps running a little. */
  paint(mediaTime: number, clockRunsTo: number) {
    this.currentTime = mediaTime;
    this.frameCallback?.(0, { mediaTime });
    this.currentTime = clockRunsTo;
  }

  pause() {
    this.paused = true;
    queueMicrotask(() => this.dispatchEvent(new Event('pause')));
  }
}

const setup = () => {
  const video = new FakeVideo();
  const ref = { current: video as unknown as HTMLVideoElement };
  const hook = renderHook(() => useVideoClock(ref, { src: 'clip.mp4' }));
  return { hook, video };
};

describe('useVideoClock', () => {
  it('pauses on the frame that was on screen, not where the media clock ran to', async () => {
    const { hook, video } = setup();
    act(() => video.paint(7.42, 7.44));

    // A note made at the press names the painted frame...
    expect(hook.result.current.controls.frameTime()).toBe(7.42);
    await act(async () => hook.result.current.controls.pause());

    // ...and after the pause the clock and the readout agree with it, so a
    // region drawn now is shown on the frame it was drawn on.
    expect(video.currentTime).toBe(7.42);
    expect(hook.result.current.time).toBe(7.42);
  });

  it('never lets the late pause event drag a seek back to the old frame', async () => {
    const { hook, video } = setup();
    act(() => video.paint(7.42, 7.44));

    await act(async () => {
      hook.result.current.controls.pause();
      hook.result.current.controls.seek(3);
    });

    expect(video.currentTime).toBe(3);
  });

  it('keeps stepping one frame at a time when a stale frame is reported after a paused seek', async () => {
    const { hook, video } = setup();
    video.paused = true;
    video.currentTime = 163.5 / 30;
    // The browser reports the frame that was up before the seek landed.
    act(() => video.paint(162 / 30, 163.5 / 30));

    await act(async () => hook.result.current.controls.step(1));

    expect(video.currentTime).toBeCloseTo(164.5 / 30, 5);
  });

  it('steps from the painted frame while playing', async () => {
    const { hook, video } = setup();
    act(() => video.paint(7.42, 7.48));

    await act(async () => hook.result.current.controls.step(1));

    // 7.42s is frame 222; one step lands in the middle of frame 223.
    expect(video.currentTime).toBeCloseTo(223.5 / 30, 5);
  });
});
