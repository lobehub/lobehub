// LobeHub chat streaming time-series probe.
//
// Inject into the renderer (via agent-browser eval) to record store + DOM
// snapshots every 200ms during a streaming session. Designed to surface
// "UI rolled back to an earlier state" symptoms — especially around
// gateway-mode tab switches that happen while the assistant is still writing.
//
// Usage:
//   agent-browser --cdp 9222 eval --stdin < probe.js
//   # ...do test interactions, call window.__PROBE_EVENT('LABEL') to mark moments...
//   agent-browser --cdp 9222 eval --stdin < probe-dump.js > /tmp/probe.json
//   node analyze.mjs /tmp/probe.json
//
// What it captures per sample:
//   - activeTopicId
//   - msgN: top-level messages in chat.messagesMap for this topic
//   - childN: total assistantGroup.children blocks across all msgs (THIS is
//     where streaming content actually lives — top-level assistantGroup stays empty)
//   - cT / rT / toolT: totals across messages AND their children
//                       (content, reasoning, tool-call count)
//   - perMsg: per-message breakdown so regressions can be located precisely
//   - runOps: number of running operations (execServerAgentRuntime etc.)
//   - domLen: total innerText length of the rendered chat list area
//   - ind: visible UI indicators (Search pages, Crawled pages, Deeply Thought, Sending)
//
// Event markers: window.__PROBE_EVENT('NAME') records {t, name} into
// __PROBE_EVENTS, used by the analyzer to align state changes with
// user-driven actions (SENT, AWAY_1, BACK_1, ...).

(function () {
  if (window.__PROBE_TIMER) clearInterval(window.__PROBE_TIMER);
  window.__PROBE_SAMPLES = [];
  window.__PROBE_EVENTS = [];
  const t0 = Date.now();

  function snapshot() {
    try {
      const chat = window.__LOBE_STORES.chat();
      const topicId = chat.activeTopicId;
      const idTail = topicId ? topicId.replace('tpc_', '') : null;
      const keys = Object.keys(chat.messagesMap || {});

      // Collect messages for the active topic. Before a topic is committed,
      // optimistic messages live under the `<agentScope>_new` key — fall
      // back to those when no topic is active yet.
      let msgs = [];
      if (idTail) {
        keys.forEach((k) => {
          if (k.includes(idTail)) msgs = msgs.concat(chat.messagesMap[k] || []);
        });
      } else {
        keys
          .filter((k) => k.endsWith('_new'))
          .forEach((k) => {
            msgs = msgs.concat(chat.messagesMap[k] || []);
          });
      }

      // Walk top-level + assistantGroup.children. children carry the actual
      // streamed content / reasoning / tool calls; the parent assistantGroup
      // remains a placeholder (cLen=0, rLen=0) for its whole lifetime.
      let totalContent = 0;
      let totalReason = 0;
      let totalTools = 0;
      let childCount = 0;
      const perMsg = msgs.map((m) => {
        const cLen = (m.content || '').length;
        const rLen = ((m.reasoning && m.reasoning.content) || '').length;
        const tools = (m.tools || []).length;
        totalContent += cLen;
        totalReason += rLen;
        totalTools += tools;

        const children = m.children || [];
        let chC = 0;
        let chR = 0;
        let chT = 0;
        children.forEach((c) => {
          chC += (c.content || '').length;
          chR += ((c.reasoning && c.reasoning.content) || '').length;
          chT += (c.tools || []).length;
        });
        totalContent += chC;
        totalReason += chR;
        totalTools += chT;
        childCount += children.length;

        return {
          id: (m.id || '').slice(-8),
          role: m.role,
          cLen,
          rLen,
          tools,
          chCount: children.length,
          chC,
          chR,
          chT,
        };
      });

      const ops = Object.values(chat.operations || {});
      const runningOps = ops.filter((o) => o.status === 'running');

      // DOM probe: total rendered text in the chat scroll area (proxy for
      // "how much is actually visible to the user").
      const convScroll =
        document.querySelector(
          '[data-chat-list], [class*="ChatList"], [class*="ConversationList"]',
        ) ||
        document.querySelector('main [class*="scroll"]') ||
        document.querySelector('main');
      const domTxt = convScroll ? convScroll.innerText || '' : '';

      const bodyTxt = document.body.innerText || '';
      const searchMatches = (bodyTxt.match(/Search pages?:|Searched the web/g) || []).length;
      const crawlMatches = (bodyTxt.match(/Crawl(ed|ing) pages?/g) || []).length;

      window.__PROBE_SAMPLES.push({
        t: Date.now() - t0,
        topicId,
        msgN: msgs.length,
        childN: childCount,
        cT: totalContent,
        rT: totalReason,
        toolT: totalTools,
        perMsg,
        runOps: runningOps.length,
        runOpTypes: runningOps.map((o) => o.type),
        domLen: domTxt.length,
        ind: {
          search: searchMatches,
          crawl: crawlMatches,
          sending: bodyTxt.includes('Sending message'),
          deeplyThinking: bodyTxt.includes('Deeply Thinking'),
          deeplyThought: bodyTxt.includes('Deeply Thought'),
        },
      });
    } catch (e) {
      window.__PROBE_SAMPLES.push({ t: Date.now() - t0, err: e.message });
    }
  }

  snapshot();
  window.__PROBE_TIMER = setInterval(snapshot, 200);
  window.__PROBE_EVENT = function (name) {
    window.__PROBE_EVENTS.push({ t: Date.now() - t0, name });
  };

  // Tab-switch helpers installed alongside the probe.
  //
  // The Electron tab bar mounts each tab as a div with data-insp-path
  // ending in `TabItem.tsx:...`. The active tab is marked with
  // data-active="true". DO NOT search by innerText — the active tab's text
  // includes a ` · <agent name>` suffix that produces false matches when
  // your search string happens to overlap with the agent name.
  function listTabs() {
    return Array.from(
      document.querySelectorAll('[data-insp-path*="TabItem.tsx"][data-contextmenu-trigger]'),
    ).filter((t) => t.getBoundingClientRect().top < 30);
  }
  function tabKey(el) {
    // Stable for the tab's lifetime; survives focus changes.
    return el.getAttribute('data-contextmenu-trigger');
  }
  function findActiveTab() {
    return listTabs().find((t) => t.getAttribute('data-active') === 'true') || null;
  }

  // Click by stable key captured earlier (preferred for round-trips).
  window.__clickTabByKey = function (key) {
    const tab = listTabs().find((t) => tabKey(t) === key);
    if (!tab) return 'not found: key=' + key;
    if (tab.getAttribute('data-active') === 'true') return 'already active: ' + key;
    tab.click();
    return 'clicked key=' + key;
  };

  // Click by index in the tab strip (0-based, left-to-right).
  window.__clickTabByIndex = function (i) {
    const tabs = listTabs();
    if (i < 0 || i >= tabs.length) return 'index out of range: ' + i + '/' + tabs.length;
    const t = tabs[i];
    if (t.getAttribute('data-active') === 'true') return 'already active: i=' + i;
    t.click();
    return 'clicked i=' + i + ' key=' + tabKey(t);
  };

  // Snapshot all tabs in order: [{key, active, title (first 60 chars of innerText)}]
  window.__listTabs = function () {
    return listTabs().map((t, i) => ({
      i,
      key: tabKey(t),
      active: t.getAttribute('data-active') === 'true',
      title: (t.innerText || '').slice(0, 60),
    }));
  };

  window.__activeTabKey = function () {
    const a = findActiveTab();
    return a ? tabKey(a) : null;
  };

  return 'probe installed';
})();
