'use client';

import { useSyncExternalStore } from 'react';

import { meetingRecorder } from './recorder';

/** Subscribe a component to the app-wide meeting recorder. */
export const useMeetingRecorder = () => {
  const snapshot = useSyncExternalStore(
    meetingRecorder.subscribe,
    meetingRecorder.getSnapshot,
    meetingRecorder.getSnapshot,
  );
  return { recorder: meetingRecorder, snapshot };
};
