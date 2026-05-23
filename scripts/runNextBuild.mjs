import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const WEBPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB = 6144;
export const VERCEL_BUILD_SYSTEM_REPORT = '1';
export const LOBE_BUILD_DIAGNOSTICS = '1';
export const BUILD_RSS_SAMPLING_INTERVAL_MS = 30_000;
const MAX_OLD_SPACE_SIZE_PATTERN = /--max-old-space-size=\S+/;
const PROCESS_TABLE_FIELDS = ['pid=', 'ppid=', 'rss=', 'pcpu=', 'etime=', 'comm='];

function logBuildStep(step, details) {
  if (details) {
    console.error(`[build:next] ${step}`, details);
    return;
  }

  console.error(`[build:next] ${step}`);
}

function formatMiB(bytes = 0) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

export function createMemorySnapshot(processLike = process) {
  const usage = processLike.memoryUsage();

  return {
    arrayBuffers: formatMiB(usage.arrayBuffers),
    external: formatMiB(usage.external),
    heapTotal: formatMiB(usage.heapTotal),
    heapUsed: formatMiB(usage.heapUsed),
    rss: formatMiB(usage.rss),
  };
}

function parseProcessTableLine(line) {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
  if (!match) return;

  const [, pid, ppid, rssKiB, pcpu, etime, command] = match;

  return {
    command,
    etime,
    pcpu: Number.parseFloat(pcpu),
    pid: Number.parseInt(pid, 10),
    ppid: Number.parseInt(ppid, 10),
    rssKiB: Number.parseInt(rssKiB, 10),
  };
}

export function parseProcessTable(output) {
  return output
    .split('\n')
    .map((line) => parseProcessTableLine(line))
    .filter(Boolean);
}

export function createProcessTreeSnapshot(rootPid, psOutput) {
  const processes = parseProcessTable(psOutput);
  const byParent = new Map();
  const byPid = new Map();

  for (const processInfo of processes) {
    byPid.set(processInfo.pid, processInfo);

    const siblings = byParent.get(processInfo.ppid);
    if (siblings) {
      siblings.push(processInfo);
      continue;
    }

    byParent.set(processInfo.ppid, [processInfo]);
  }

  if (!byPid.has(rootPid)) {
    return {
      processCount: 0,
      rootPid,
      topProcesses: [],
      totalRss: formatMiB(0),
    };
  }

  const queue = [rootPid];
  const descendants = [];

  while (queue.length > 0) {
    const pid = queue.shift();
    if (!pid) continue;

    const current = byPid.get(pid);
    if (!current) continue;

    descendants.push(current);

    const children = byParent.get(pid) || [];
    for (const child of children) {
      queue.push(child.pid);
    }
  }

  const totalRssBytes = descendants.reduce(
    (sum, processInfo) => sum + processInfo.rssKiB * 1024,
    0,
  );

  const topProcesses = [...descendants]
    .sort((left, right) => right.rssKiB - left.rssKiB)
    .slice(0, 5)
    .map((processInfo) => ({
      command: processInfo.command,
      etime: processInfo.etime,
      pcpu: processInfo.pcpu,
      pid: processInfo.pid,
      rss: formatMiB(processInfo.rssKiB * 1024),
    }));

  return {
    processCount: descendants.length,
    rootPid,
    topProcesses,
    totalRss: formatMiB(totalRssBytes),
  };
}

function getProcessTreeSnapshot(rootPid) {
  const psOutput = execFileSync('ps', ['-eo', PROCESS_TABLE_FIELDS.join(',')], {
    encoding: 'utf8',
  });

  return createProcessTreeSnapshot(rootPid, psOutput);
}

export function getVercelNodeOptions(nodeOptions = '') {
  const maxOldSpaceSizeOption = `--max-old-space-size=${WEBPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB}`;

  if (!nodeOptions.trim()) return maxOldSpaceSizeOption;

  if (MAX_OLD_SPACE_SIZE_PATTERN.test(nodeOptions)) {
    return nodeOptions.replace(MAX_OLD_SPACE_SIZE_PATTERN, maxOldSpaceSizeOption);
  }

  return `${nodeOptions} ${maxOldSpaceSizeOption}`;
}

export function getNextBuildArgs(extraArgs = [], isVercel = Boolean(process.env.VERCEL_ENV)) {
  const args = ['build'];

  return isVercel ? [...args, ...extraArgs] : [...args, ...extraArgs];
}

export function getVercelBuildEnv(env = process.env) {
  return {
    ...env,
    LOBE_BUILD_DIAGNOSTICS: env.LOBE_BUILD_DIAGNOSTICS ?? LOBE_BUILD_DIAGNOSTICS,
    NODE_OPTIONS: getVercelNodeOptions(env.NODE_OPTIONS),
    VERCEL_BUILD_SYSTEM_REPORT: env.VERCEL_BUILD_SYSTEM_REPORT ?? VERCEL_BUILD_SYSTEM_REPORT,
  };
}

export function runNextBuild({
  argv = process.argv.slice(2),
  env = process.env,
  spawnImpl = spawn,
  processLike = process,
} = {}) {
  const isVercel = Boolean(env.VERCEL_ENV);
  const nextBin = require.resolve('next/dist/bin/next');
  const nextArgs = getNextBuildArgs(argv, isVercel);
  const childEnv = isVercel ? getVercelBuildEnv(env) : { ...env };

  logBuildStep('start', {
    env: isVercel
      ? {
          LOBE_BUILD_DIAGNOSTICS: childEnv.LOBE_BUILD_DIAGNOSTICS,
          NODE_OPTIONS: childEnv.NODE_OPTIONS,
          VERCEL_ENV: env.VERCEL_ENV,
        }
      : {
          VERCEL_ENV: env.VERCEL_ENV ?? null,
        },
    nextArgs,
  });

  const child = spawnImpl(process.execPath, [nextBin, ...getNextBuildArgs(argv, isVercel)], {
    env: childEnv,
    stdio: 'inherit',
  });
  const interval =
    isVercel &&
    setInterval(() => {
      try {
        logBuildStep('process tree snapshot', getProcessTreeSnapshot(child.pid));
      } catch (error) {
        logBuildStep('process tree snapshot failed', error);
      }
    }, BUILD_RSS_SAMPLING_INTERVAL_MS);

  child.on('error', (error) => {
    if (interval) clearInterval(interval);
    logBuildStep('child error', error);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (interval) clearInterval(interval);

    if (signal) {
      logBuildStep('terminated by signal', signal);
      process.kill(process.pid, signal);
      return;
    }

    logBuildStep('finished', { code: code ?? 1 });
    process.exit(code ?? 1);
  });

  return child;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runNextBuild();
}
