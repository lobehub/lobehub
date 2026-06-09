// Run N round-trip tab switches with event markers timed against the probe.
//
//   agent-browser --cdp 9222 eval --stdin < tab-switch.js
//
// Captures the currently-active tab as the BACK target and the rightmost
// inactive tab as the AWAY target. Both are addressed by their stable
// data-contextmenu-trigger key (NOT by visible title — the active tab's
// innerText embeds a ` · <agent name>` suffix that breaks text matching).
//
// Fires the loop in the background and returns immediately so the
// agent-browser eval doesn't have to await the full ROUND_TRIPS × DWELL_MS
// duration. Wait on the `SWITCH_LOOP_DONE` event before dumping.
//
// Refuses to launch if a previous loop is still in flight.
//
// Requires probe.js to have been installed first (provides
// window.__PROBE_EVENT / __listTabs / __clickTabByKey / __activeTabKey).

(function () {
  const ROUND_TRIPS = 4;
  const DWELL_MS = 10_000;

  if (!window.__PROBE_EVENT || !window.__listTabs || !window.__clickTabByKey) {
    return 'probe not installed — eval probe.js first';
  }
  if (window.__SWITCH_LOOP_RUNNING) {
    return 'switch loop already running — wait for SWITCH_LOOP_DONE first';
  }

  const tabs = window.__listTabs();
  const activeTab = tabs.find((t) => t.active);
  if (!activeTab) return 'no active tab — abort';

  // Pick the first inactive tab as AWAY target. With multiple inactive tabs
  // you'll usually want the one that's stable across the test — feel free
  // to swap to tabs[tabs.length-1] if you want the rightmost.
  const inactives = tabs.filter((t) => !t.active);
  if (inactives.length === 0) return 'no inactive tab to switch to — abort';
  const awayTab = inactives.at(-1); // rightmost inactive

  const BACK_KEY = activeTab.key;
  const AWAY_KEY = awayTab.key;

  window.__SWITCH_LOOP_RUNNING = true;
  window.__PROBE_EVENT('SWITCH_LOOP_CONFIG:back=' + BACK_KEY + ',away=' + AWAY_KEY);

  (async function () {
    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    try {
      window.__PROBE_EVENT('SWITCH_LOOP_START');
      for (let i = 1; i <= ROUND_TRIPS; i++) {
        window.__PROBE_EVENT('AWAY_' + i);
        const awayResult = window.__clickTabByKey(AWAY_KEY);
        window.__PROBE_EVENT('AWAY_' + i + '_RES:' + awayResult.slice(0, 50));
        await sleep(DWELL_MS);

        window.__PROBE_EVENT('BACK_' + i);
        const backResult = window.__clickTabByKey(BACK_KEY);
        window.__PROBE_EVENT('BACK_' + i + '_RES:' + backResult.slice(0, 50));
        await sleep(DWELL_MS);
      }
      window.__PROBE_EVENT('SWITCH_LOOP_DONE');
    } finally {
      window.__SWITCH_LOOP_RUNNING = false;
    }
  })();

  return 'switch loop kicked off (BACK=' + BACK_KEY + ', AWAY=' + AWAY_KEY + ')';
})();
