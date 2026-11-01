import { useSyncExternalStore } from 'react';

import { isDesktop } from '@/const/version';
import { electronDevtoolsService } from '@/services/electron/devtools';

export type ProcessSnapshot = Awaited<
  ReturnType<typeof electronDevtoolsService.getManagedProcesses>
>;
export type ProcessRow = ProcessSnapshot['processes'][number];
export interface Activity extends Pick<ProcessRow, 'rootId' | 'topicId' | 'agentId' | 'label'> {
  cpuPercent: number | null;
  memoryMB: number;
  processes: ProcessRow[];
  severity: 'normal' | 'warning' | 'critical';
}

export const groupActivities = (snapshot: ProcessSnapshot): Activity[] => {
  const groups = new Map<string, Activity>();
  for (const row of snapshot.processes) {
    let group = groups.get(row.rootId);
    if (!group) {
      group = {
        rootId: row.rootId,
        topicId: row.topicId,
        agentId: row.agentId,
        label: row.label || row.name,
        memoryMB: 0,
        cpuPercent: null,
        processes: [],
        severity: 'normal',
      };
      groups.set(row.rootId, group);
    }
    group.memoryMB += row.memoryMB;
    if (row.cpuPercent !== null) group.cpuPercent = (group.cpuPercent ?? 0) + row.cpuPercent;
    group.processes.push(row);
  }
  for (const group of groups.values()) {
    // ponytail: resident sets can count shared pages twice; use private footprint if this becomes a memory limiter.
    group.severity =
      group.memoryMB >= Math.min(4096, snapshot.totalMemoryMB * 0.3)
        ? 'critical'
        : group.memoryMB >= Math.min(2048, snapshot.totalMemoryMB * 0.15) ||
            (group.cpuPercent ?? 0) >= 200
          ? 'warning'
          : 'normal';
  }
  return [...groups.values()];
};

export const formatMemory = (mb: number) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;

export const formatCpu = (percent: number | null) =>
  percent === null ? '—' : `${Math.round(percent)}%`;

export const sumCpu = (activities: Activity[]) =>
  activities.some((row) => row.cpuPercent !== null)
    ? activities.reduce((sum, row) => sum + (row.cpuPercent ?? 0), 0)
    : null;

export const processTree = (processes: ProcessRow[]) => {
  const pids = new Set(processes.map((row) => row.pid));
  const children = new Map<number, ProcessRow[]>();
  const roots: ProcessRow[] = [];
  for (const row of processes) {
    if (pids.has(row.ppid) && row.ppid !== row.pid) {
      const siblings = children.get(row.ppid) ?? [];
      siblings.push(row);
      children.set(row.ppid, siblings);
    } else roots.push(row);
  }
  const ordered: { depth: number; row: ProcessRow }[] = [];
  const seen = new Set<number>();
  const visit = (row: ProcessRow, depth: number) => {
    if (seen.has(row.pid)) return;
    seen.add(row.pid);
    ordered.push({ depth, row });
    for (const child of children.get(row.pid) ?? []) visit(child, depth + 1);
  };
  for (const row of roots) visit(row, 0);
  for (const row of processes) visit(row, 0);
  return ordered;
};

interface State {
  activities: Activity[];
  error: boolean;
  loaded: boolean;
  sampledAt: number;
  selected?: string;
  totalMemoryMB: number;
}
let state: State = { activities: [], error: false, loaded: false, sampledAt: 0, totalMemoryMB: 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let pending: Promise<void> | undefined;
const emit = () => {
  for (const listener of listeners) listener();
};
export const selectActivity = (id: string) => {
  state = { ...state, selected: id };
  emit();
};
export const refreshActivities = () => {
  pending ??= electronDevtoolsService
    .getManagedProcesses()
    .then((snapshot) => {
      state = {
        ...state,
        activities: groupActivities(snapshot),
        sampledAt: snapshot.sampledAt,
        totalMemoryMB: snapshot.totalMemoryMB,
        error: false,
        loaded: true,
      };
    })
    .catch((error) => {
      console.error('Cannot sample background processes:', error);
      state = { ...state, error: true, loaded: true };
    })
    .finally(() => {
      pending = undefined;
      emit();
    });
  return pending;
};
export const stopActivity = async (rootId: string) => {
  await electronDevtoolsService.stopManagedProcess(rootId);
  await refreshActivities();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (isDesktop && !timer) {
    void refreshActivities();
    timer = setInterval(refreshActivities, 2000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
};
export const useActivities = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );

/** One alert per episode, with escalation; require three sustained warning samples. */
export class ResourceAlerts {
  private episodes = new Map<string, { samples: number; notified: number; recovered: number }>();
  update(activities: Activity[]) {
    const alerts: Activity[] = [];
    const ids = new Set(activities.map((item) => item.rootId));
    for (const id of this.episodes.keys()) if (!ids.has(id)) this.episodes.delete(id);
    for (const activity of activities) {
      const episode = this.episodes.get(activity.rootId) ?? {
        samples: 0,
        notified: 0,
        recovered: 0,
      };
      const level = activity.severity === 'critical' ? 2 : activity.severity === 'warning' ? 1 : 0;
      if (!level) {
        episode.samples = 0;
        if (++episode.recovered >= 3) episode.notified = 0;
      } else {
        episode.recovered = 0;
        episode.samples++;
        if ((level === 2 || episode.samples >= 3) && level > episode.notified) {
          alerts.push(activity);
          episode.notified = level;
        }
      }
      this.episodes.set(activity.rootId, episode);
    }
    return alerts;
  }
}
