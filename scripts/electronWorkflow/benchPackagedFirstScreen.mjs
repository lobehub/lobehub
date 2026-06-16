import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const probeScript = String.raw`
(() => {
  if (window.__LOBEBENCH__) return;

  const STABLE_WINDOW_MS = 1500;
  const records = {
    appShellAt: 0,
    businessReadyExitCount: 0,
    firstBusinessFlashAt: 0,
    injectedAt: performance.now(),
    domContentLoadedAt: 0,
    firstMeaningfulRootTextAt: 0,
    homeInputAt: 0,
    lastBusinessReadyEnterAt: 0,
    lastBusinessReadyExitAt: 0,
    loadAt: 0,
    loadingRemovedAt: 0,
    rootMountedAt: 0,
    sampleText: '',
    stableBusinessConfirmedAt: 0,
    stableBusinessFirstScreenAt: 0,
    stableWindowMs: STABLE_WINDOW_MS,
  };

  const root = () => document.querySelector('#root');
  const rootText = () => (root()?.innerText || '').replace(/\s+/g, ' ').trim();
  const hasStaticLoading = () => Boolean(document.querySelector('#loading-screen'));
  const isVisible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const visibleEditable = () =>
    Array.from(document.querySelectorAll('[contenteditable="true"]')).find(isVisible);
  const hasAppShellText = (text) =>
    /\bHome\b/.test(text) &&
    /\bSearch\b/.test(text) &&
    /\bTasks\b/.test(text) &&
    /\bAgents\b/.test(text);
  const hasHomeBusinessText = (text) =>
    /Ask, create, or start a task|Claude|GPT Image|Seedance|New/.test(text);
  const isBusinessReady = (text) =>
    !hasStaticLoading() &&
    isVisible(root()) &&
    hasAppShellText(text) &&
    hasHomeBusinessText(text) &&
    Boolean(visibleEditable()) &&
    text.length > 120;

  let observer;
  let businessReady = false;
  let stableTimer = 0;

  const clearStableTimer = () => {
    if (!stableTimer) return;
    clearTimeout(stableTimer);
    stableTimer = 0;
  };

  const scheduleStableConfirmation = () => {
    clearStableTimer();
    stableTimer = setTimeout(() => {
      stableTimer = 0;
      mark();
    }, STABLE_WINDOW_MS);
  };

  const mark = () => {
    const now = performance.now();
    const currentRoot = root();
    const text = rootText();
    const editor = visibleEditable();

    if (!records.rootMountedAt && currentRoot?.childElementCount) records.rootMountedAt = now;
    if (!records.loadingRemovedAt && !hasStaticLoading()) records.loadingRemovedAt = now;
    if (!records.firstMeaningfulRootTextAt && text.length > 80) {
      records.firstMeaningfulRootTextAt = now;
    }
    if (!records.appShellAt && hasAppShellText(text)) records.appShellAt = now;
    if (!records.homeInputAt && editor) records.homeInputAt = now;

    const nextBusinessReady = isBusinessReady(text);

    if (nextBusinessReady && !businessReady) {
      businessReady = true;
      records.lastBusinessReadyEnterAt = now;
      if (!records.firstBusinessFlashAt) records.firstBusinessFlashAt = now;
      records.sampleText = text.slice(0, 240);
      scheduleStableConfirmation();
    }

    if (!nextBusinessReady && businessReady) {
      businessReady = false;
      records.businessReadyExitCount += 1;
      records.lastBusinessReadyExitAt = now;
      clearStableTimer();
    }

    if (
      nextBusinessReady &&
      !records.stableBusinessFirstScreenAt &&
      records.lastBusinessReadyEnterAt &&
      now - records.lastBusinessReadyEnterAt >= STABLE_WINDOW_MS
    ) {
      records.stableBusinessFirstScreenAt = records.lastBusinessReadyEnterAt;
      records.stableBusinessConfirmedAt = now;
      records.sampleText = text.slice(0, 240);
      observer?.disconnect();
      clearStableTimer();
    }
  };

  window.__LOBEBENCH__ = {
    mark,
    records,
    snapshot() {
      mark();
      const paints = Object.fromEntries(
        performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]),
      );

      return {
        href: location.href,
        now: performance.now(),
        paints,
        readyState: document.readyState,
        records,
        rootTextLength: rootText().length,
        title: document.title,
      };
    },
  };

  observer = new MutationObserver(mark);
  observer.observe(document.documentElement || document, {
    characterData: true,
    childList: true,
    subtree: true,
  });

  document.addEventListener('DOMContentLoaded', () => {
    records.domContentLoadedAt = performance.now();
    mark();
  });

  window.addEventListener('load', () => {
    records.loadAt = performance.now();
    mark();
  });

  mark();
})();
`;

const parseArgs = () => {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    args.set(process.argv[index], process.argv[index + 1]);
  }

  const beforeApp = args.get('--before-app');
  const afterApp = args.get('--after-app');
  if (!beforeApp || !afterApp) {
    throw new Error(
      'Usage: node scripts/electronWorkflow/benchPackagedFirstScreen.mjs --before-app <app> --after-app <app> [--runs 5]',
    );
  }

  return {
    afterApp,
    beforeApp,
    runs: Number(args.get('--runs') ?? 5),
  };
};

const executableForApp = (appPath) => {
  const executable = path.join(appPath, 'Contents', 'MacOS', 'lobehub-desktop-dev');
  if (!existsSync(executable)) {
    throw new Error(`Packaged Electron executable not found: ${executable}`);
  }

  return executable;
};

const waitForJson = async (url, timeoutMs) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}

    await sleep(100);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const waitForPageTarget = async (port, timeoutMs) => {
  const startedAt = Date.now();
  let lastTargets = [];
  while (Date.now() - startedAt < timeoutMs) {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, 5000).catch(() => []);
    lastTargets = targets;
    const page = targets.find(
      (target) => target.type === 'page' && target.url?.startsWith('app://renderer'),
    );

    if (page?.webSocketDebuggerUrl) return page;
    await sleep(100);
  }

  throw new Error(
    `Timed out waiting for app://renderer page target on port ${port}: ${JSON.stringify(lastTargets)}`,
  );
};

class CdpClient {
  #id = 0;
  #pending = new Map();
  #socket;

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;

      const pending = this.#pending.get(message.id);
      if (!pending) return;

      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  static async connect(url, timeoutMs) {
    const socket = new WebSocket(url);
    await Promise.race([
      new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener(
          'error',
          () => reject(new Error(`Failed to open CDP websocket ${url}`)),
          { once: true },
        );
      }),
      sleep(timeoutMs).then(() => {
        throw new Error(`Timed out opening CDP websocket ${url}`);
      }),
    ]);

    return new CdpClient(socket);
  }

  close() {
    this.#socket.close();
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.#id;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);

      this.#pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });

      this.#socket.send(payload);
    });
  }
}

const evaluate = async (client, expression, timeoutMs = 30_000) => {
  const result = await client.send(
    'Runtime.evaluate',
    {
      awaitPromise: true,
      expression,
      returnByValue: true,
    },
    timeoutMs,
  );

  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }

  return result.result?.value;
};

const stopProcess = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    process.kill(-child.pid, 'SIGINT');
  } catch {}

  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    sleep(5000).then(() => false),
  ]);

  if (exited) return;

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}

  const terminated = await Promise.race([
    once(child, 'exit').then(() => true),
    sleep(3000).then(() => false),
  ]);

  if (terminated) return;

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
};

const runOnce = async ({ appPath, caseName, index, port }) => {
  const executable = executableForApp(appPath);
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    cwd: path.dirname(executable),
    detached: true,
    env: {
      ...process.env,
      npm_config_update_notifier: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    output = output.slice(-12_000);
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
    output = output.slice(-12_000);
  });

  const earlyExit = once(child, 'exit').then(([code, signal]) => {
    throw new Error(`Packaged Electron exited before measurement: code=${code} signal=${signal}`);
  });
  earlyExit.catch(() => {});

  const startedAt = Date.now();
  let client;
  try {
    await Promise.race([waitForJson(`http://127.0.0.1:${port}/json/version`, 120_000), earlyExit]);

    const target = await waitForPageTarget(port, 90_000);
    client = await CdpClient.connect(target.webSocketDebuggerUrl, 30_000);
    await client.send('Page.enable');
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: probeScript });
    await evaluate(client, probeScript);

    const waitStartedAt = Date.now();
    let snapshot;
    while (Date.now() - waitStartedAt < 90_000) {
      snapshot = await evaluate(client, 'window.__LOBEBENCH__?.snapshot()');
      if (snapshot?.records?.stableBusinessFirstScreenAt) break;
      await sleep(100);
    }

    if (!snapshot?.records?.stableBusinessFirstScreenAt) {
      throw new Error(
        `Timed out waiting for stable business first screen: ${JSON.stringify(snapshot)}`,
      );
    }

    return {
      caseName,
      index,
      pageMetricMs: snapshot.records.stableBusinessFirstScreenAt,
      port,
      probeInjectedAt: snapshot.records.injectedAt,
      rootTextLength: snapshot.rootTextLength,
      sampleText: snapshot.records.sampleText,
      spawnToMetricMs: Date.now() - startedAt,
      timings: {
        appShellAt: snapshot.records.appShellAt,
        businessReadyExitCount: snapshot.records.businessReadyExitCount,
        domContentLoadedAt: snapshot.records.domContentLoadedAt,
        firstBusinessFlashAt: snapshot.records.firstBusinessFlashAt,
        firstContentfulPaint: snapshot.paints['first-contentful-paint'] ?? null,
        firstMeaningfulRootTextAt: snapshot.records.firstMeaningfulRootTextAt,
        firstPaint: snapshot.paints['first-paint'] ?? null,
        homeInputAt: snapshot.records.homeInputAt,
        lastBusinessReadyExitAt: snapshot.records.lastBusinessReadyExitAt,
        loadAt: snapshot.records.loadAt,
        loadingRemovedAt: snapshot.records.loadingRemovedAt,
        rootMountedAt: snapshot.records.rootMountedAt,
        stableBusinessConfirmedAt: snapshot.records.stableBusinessConfirmedAt,
        stableBusinessFirstScreenAt: snapshot.records.stableBusinessFirstScreenAt,
        stableWindowMs: snapshot.records.stableWindowMs,
      },
      url: snapshot.href,
    };
  } catch (error) {
    return {
      caseName,
      error: String(error?.stack || error),
      index,
      output,
      port,
      spawnToMetricMs: Date.now() - startedAt,
    };
  } finally {
    if (client) client.close();
    await stopProcess(child);
  }
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const summarize = (caseName, results) => {
  const successful = results.filter((result) => typeof result.pageMetricMs === 'number');
  return {
    caseName,
    failures: results.length - successful.length,
    medianPageMetricMs: successful.length
      ? median(successful.map((result) => result.pageMetricMs))
      : null,
    medianSpawnToMetricMs: successful.length
      ? median(successful.map((result) => result.spawnToMetricMs))
      : null,
    runs: results.length,
    successfulRuns: successful.length,
  };
};

const main = async () => {
  const { afterApp, beforeApp, runs } = parseArgs();
  const cases = [
    { appPath: beforeApp, name: 'before' },
    { appPath: afterApp, name: 'after' },
  ];

  const allResults = {};
  for (const testCase of cases) {
    allResults[testCase.name] = [];

    for (let index = 1; index <= runs; index += 1) {
      const port = testCase.name === 'before' ? 9500 + index : 9600 + index;
      console.log(`[bench] ${testCase.name} run ${index}/${runs} on port ${port}`);
      const result = await runOnce({
        appPath: testCase.appPath,
        caseName: testCase.name,
        index,
        port,
      });
      allResults[testCase.name].push(result);
      console.log(JSON.stringify(result));
    }
  }

  const summary = {
    after: summarize('after', allResults.after),
    before: summarize('before', allResults.before),
  };

  summary.deltaPageMetricMs =
    summary.after.medianPageMetricMs === null || summary.before.medianPageMetricMs === null
      ? null
      : summary.after.medianPageMetricMs - summary.before.medianPageMetricMs;
  summary.deltaSpawnToMetricMs =
    summary.after.medianSpawnToMetricMs === null || summary.before.medianSpawnToMetricMs === null
      ? null
      : summary.after.medianSpawnToMetricMs - summary.before.medianSpawnToMetricMs;

  const report = {
    apps: {
      after: afterApp,
      before: beforeApp,
    },
    results: allResults,
    summary,
  };
  const outputPath = `/tmp/lobe-electron-packaged-first-screen-benchmark-${Date.now()}.json`;
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[bench] report ${outputPath}`);
  console.log(JSON.stringify(summary, null, 2));
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
