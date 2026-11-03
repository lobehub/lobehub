// Stop the probe and serialize collected data.
//
//   agent-browser --cdp 9222 eval --stdin < probe-dump.js > /tmp/probe.json
//
// The whole thing is wrapped in a JSON.stringify so agent-browser returns it
// as a single quoted string — the analyzer double-parses to handle that.

(function () {
  if (window.__PROBE_TIMER) {
    clearInterval(window.__PROBE_TIMER);
    window.__PROBE_TIMER = null;
  }
  return JSON.stringify({
    events: window.__PROBE_EVENTS || [],
    samples: window.__PROBE_SAMPLES || [],
  });
})();
