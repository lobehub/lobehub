import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';

export interface CpuTimes {
  idle: number;
  total: number;
}

export interface MemoryUsage {
  totalBytes: number;
  usedBytes: number;
}

/** Summed across cores, so two readings give the busy share of the whole machine. */
export const readCpuTimes = (): CpuTimes => {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const { idle: cpuIdle, irq, nice, sys, user } = cpu.times;
    idle += cpuIdle;
    total += cpuIdle + irq + nice + sys + user;
  }
  return { idle, total };
};

/** Busy share of all cores between two readings, 0–100; null when no time elapsed. */
export const cpuPercentBetween = (prev: CpuTimes, next: CpuTimes): number | null => {
  const total = next.total - prev.total;
  if (total <= 0) return null;
  const busy = total - (next.idle - prev.idle);
  return Math.min(100, Math.max(0, (busy / total) * 100));
};

/**
 * `vm_stat` output → bytes in use the way Activity Monitor counts "Memory
 * Used" (app + wired + compressed). `os.freemem()` on macOS reports only
 * truly free pages, so file cache would read as used and every Mac would
 * look nearly full.
 */
export const parseVmStat = (output: string, totalBytes: number): number | undefined => {
  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1]);
  if (!pageSize) return undefined;
  const pages = (label: string) => {
    const match = new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(output);
    return match ? Number(match[1]) : 0;
  };
  const used =
    (pages('Anonymous pages') -
      pages('Pages purgeable') +
      pages('Pages wired down') +
      pages('Pages occupied by compressor')) *
    pageSize;
  return Math.min(totalBytes, Math.max(0, used));
};

/** `/proc/meminfo` → total minus MemAvailable (what `free` calls used + non-reclaimable). */
export const parseMemInfo = (content: string): MemoryUsage | undefined => {
  const kb = (label: string) => {
    const match = new RegExp(`^${label}:\\s+(\\d+) kB`, 'm').exec(content);
    return match ? Number(match[1]) * 1024 : undefined;
  };
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  if (total === undefined || available === undefined) return undefined;
  return { totalBytes: total, usedBytes: Math.max(0, total - available) };
};

const runVmStat = () =>
  new Promise<string>((resolve, reject) => {
    execFile('vm_stat', { timeout: 5000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

export const readMemoryUsage = async (): Promise<MemoryUsage> => {
  const totalBytes = os.totalmem();
  const fallback = { totalBytes, usedBytes: Math.max(0, totalBytes - os.freemem()) };
  try {
    if (process.platform === 'darwin') {
      const used = parseVmStat(await runVmStat(), totalBytes);
      return used === undefined ? fallback : { totalBytes, usedBytes: used };
    }
    if (process.platform === 'linux') {
      return parseMemInfo(await readFile('/proc/meminfo', 'utf8')) ?? fallback;
    }
  } catch {
    // Fall through to the portable reading.
  }
  return fallback;
};

/** 1 / 5 / 15 minute load averages; Windows has none (Node reports zeros). */
export const readLoadAverage = (): [number, number, number] | null => {
  if (process.platform === 'win32') return null;
  const [load1, load5, load15] = os.loadavg();
  return [load1, load5, load15];
};
