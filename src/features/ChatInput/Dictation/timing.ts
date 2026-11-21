export type RealtimeDictationTimingStage =
  'admission' | 'admission_refresh' | 'capture' | 'permission' | 'ws_ready';

export interface RealtimeDictationTiming {
  durationMs: number;
  stage: RealtimeDictationTimingStage;
}

export const REALTIME_DICTATION_PERFORMANCE_MARKS = {
  admission: 'lobe:voice-dictation:admission',
  admission_refresh: 'lobe:voice-dictation:admission_refresh',
  capture: 'lobe:voice-dictation:capture',
  permission: 'lobe:voice-dictation:permission',
  start: 'lobe:voice-dictation:start',
  ws_ready: 'lobe:voice-dictation:ws_ready',
} as const;

export const getMonotonicNow = () =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

export const clearPerformanceMarks = () => {
  if (typeof performance === 'undefined' || typeof performance.clearMarks !== 'function') return;

  try {
    for (const mark of Object.values(REALTIME_DICTATION_PERFORMANCE_MARKS)) {
      performance.clearMarks(mark);
    }
  } catch (error) {
    void error;
  }
};

export const markPerformance = (stage: RealtimeDictationTimingStage | 'start') => {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;

  const mark = REALTIME_DICTATION_PERFORMANCE_MARKS[stage];
  try {
    performance.mark(mark);
  } catch (error) {
    void error;
  }
};

export const reportTiming = (
  stage: RealtimeDictationTimingStage,
  elapsedMs: number,
  onTiming?: (timing: RealtimeDictationTiming) => void,
) => {
  markPerformance(stage);
  try {
    onTiming?.({ durationMs: Math.max(0, Math.round(elapsedMs)), stage });
  } catch (error) {
    void error;
  }
};
