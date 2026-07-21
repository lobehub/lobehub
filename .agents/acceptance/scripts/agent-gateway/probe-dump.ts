// Stops the events-probe timeline timer and stashes the full capture as a
// JSON string on `window.__PROBE_LAST_DUMP_JSON`. `run.ts` wraps the bundle
// in an IIFE that returns that global, which `agent-browser eval` prints to
// stdout — the runner then persists it under `.agent-gateway/`.

import type { ProbeDump } from './types';

declare global {
  interface Window {
    __PROBE_LAST_DUMP_JSON?: string;
  }
}

const w = window;

if (w.__PROBE_TIMELINE_TIMER) {
  clearInterval(w.__PROBE_TIMELINE_TIMER);
  w.__PROBE_TIMELINE_TIMER = null;
}

const mutations = w.__PROBE_MUTATIONS ?? [];

const dump: ProbeDump & { mutations: typeof mutations } = {
  meta: {
    t0: w.__PROBE_T0 ?? 0,
    collectedAt: Date.now(),
    sampleCount: (w.__PROBE_MSG_TIMELINE ?? []).length,
    eventCount: (w.__PROBE_STREAM_EVENTS ?? []).length,
    callCount: (w.__PROBE_ACTION_CALLS ?? []).length,
  },
  streamEvents: w.__PROBE_STREAM_EVENTS ?? [],
  actionCalls: w.__PROBE_ACTION_CALLS ?? [],
  timeline: w.__PROBE_MSG_TIMELINE ?? [],
  mutations,
};

w.__PROBE_LAST_DUMP_JSON = JSON.stringify(dump);
