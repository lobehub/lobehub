import { afterEach, describe, expect, it } from 'vitest';

import { meetingActions, meetingSelectors, useMeetingStore } from './index';
import { initialState } from './initialState';

afterEach(() => {
  useMeetingStore.setState(initialState);
});

describe('meetingActions recorder overlay', () => {
  it('opens expanded, and a live recording cannot be dismissed, only minimized', () => {
    meetingActions.openRecorder();
    expect(useMeetingStore.getState().overlay).toMatchObject({ minimized: false, open: true });

    meetingActions.patchRecorder({ meetingId: 'mtg_1', phase: 'recording' });
    meetingActions.closeRecorder();
    expect(useMeetingStore.getState().overlay.open).toBe(true);

    meetingActions.setOverlay({ minimized: true });
    expect(useMeetingStore.getState().overlay).toMatchObject({ minimized: true, open: true });
  });

  it('closing a finished recorder clears it for the next meeting', () => {
    meetingActions.openRecorder();
    meetingActions.patchRecorder({ durationMs: 5000, meetingId: 'mtg_1', phase: 'done' });

    meetingActions.closeRecorder();

    const { overlay, recorder } = useMeetingStore.getState();
    expect(overlay.open).toBe(false);
    expect(recorder).toMatchObject({ durationMs: 0, phase: 'idle' });
    expect(recorder.meetingId).toBeUndefined();
  });

  it('keeps the failed upload retryable after the recorder is dismissed', () => {
    meetingActions.openRecorder();
    meetingActions.patchRecorder({
      durationMs: 5000,
      error: 'upload_failed',
      meetingId: 'mtg_1',
      phase: 'done',
    });

    meetingActions.closeRecorder();

    const { overlay, recorder } = useMeetingStore.getState();
    expect(overlay.open).toBe(false);
    // The audio stays with the controller, and `retryUpload` needs both of these to send it again.
    expect(recorder).toMatchObject({
      durationMs: 0,
      error: 'upload_failed',
      meetingId: 'mtg_1',
      phase: 'done',
    });
  });

  it('reopening keeps the dragged position', () => {
    meetingActions.setOverlay({ position: { x: 40, y: 60 } });
    meetingActions.openRecorder();
    expect(useMeetingStore.getState().overlay.position).toEqual({ x: 40, y: 60 });
  });

  it('falls back to the system default when the chosen microphone is unplugged', () => {
    meetingActions.setDevices([{ deviceId: 'usb', label: 'USB mic' }]);
    meetingActions.selectDevice('usb');

    meetingActions.setDevices([{ deviceId: 'built-in', label: 'MacBook mic' }]);

    expect(useMeetingStore.getState().selectedDeviceId).toBeUndefined();
  });

  it('a store reset keeps a recording in progress', () => {
    meetingActions.openRecorder();
    meetingActions.patchRecorder({ meetingId: 'mtg_1', phase: 'recording' });

    meetingActions.reset();

    expect(meetingSelectors.isRecorderBusy(useMeetingStore.getState())).toBe(true);
    expect(useMeetingStore.getState().overlay.open).toBe(true);
  });
});
