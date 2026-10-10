import type { AppProcessRow } from '@lobechat/electron-client-ipc';
import type { TreeDataNode } from '@lobehub/ui/base-ui';

import {
  type Activity,
  activityLocation,
  groupByConversation,
  type ProcessRow,
  type WorkspaceSlugOf,
} from '../state';

export type SortKey = 'cpu' | 'memory';

export interface RowModel {
  agentId?: string;
  appType?: string;
  cpu: number | null;
  cpuHot?: boolean;
  /** In-app location of the message that started the activity. */
  href?: string;
  kind: 'app' | 'activity' | 'conversation' | 'process' | 'section';
  label: string;
  memory: number;
  memoryHot?: boolean;
  pid?: number;
  stopId?: string;
  sub?: string;
  topicId?: string;
}

export interface TreeLabels {
  app: string;
  background: string;
  conversation: string;
  gpu: string;
  main: string;
  processCount: (count: number) => string;
  shared: string;
  utility: string;
  window: string;
}

export interface BuildTreeInput {
  activities: Activity[];
  agentTitle: (id: string) => string | undefined;
  appProcesses: AppProcessRow[] | null;
  labels: TreeLabels;
  query: string;
  sort: SortKey;
  topicTitle: (id: string) => string | undefined;
  totalMemoryMB: number;
  workspaceSlug: WorkspaceSlugOf;
}

export const SECTION_BACKGROUND = 'section:background';
export const SECTION_APP = 'section:app';

interface Draft {
  children: Draft[];
  key: string;
  row: RowModel;
}

const metric = (row: RowModel, sort: SortKey) => (sort === 'cpu' ? (row.cpu ?? 0) : row.memory);

const sum = (rows: RowModel[]) =>
  rows.reduce(
    (total, row) => ({
      cpu: row.cpu === null ? total.cpu : (total.cpu ?? 0) + row.cpu,
      memory: total.memory + row.memory,
    }),
    { cpu: null as number | null, memory: 0 },
  );

const appRow = (process: AppProcessRow, labels: TreeLabels): RowModel => {
  const base = {
    appType: process.type,
    cpu: process.cpuPercent,
    kind: 'app' as const,
    memory: process.workingSetMB,
    pid: process.pid,
  };
  if (process.type === 'Browser') return { ...base, label: labels.app, sub: labels.main };
  if (process.type === 'GPU') return { ...base, label: labels.gpu };
  if (process.type === 'Tab')
    return { ...base, label: process.windowTitle ?? labels.window, sub: labels.window };
  if (process.type === 'Utility')
    return { ...base, label: process.name ?? labels.utility, sub: labels.utility };
  return { ...base, label: process.name ?? process.type, sub: process.type };
};

const processDrafts = (processes: ProcessRow[]): Draft[] => {
  const pids = new Set(processes.map((row) => row.pid));
  const seen = new Set<number>();
  const draft = (process: ProcessRow): Draft => {
    seen.add(process.pid);
    return {
      children: processes
        .filter((row) => row.ppid === process.pid && !seen.has(row.pid))
        .map((row) => draft(row)),
      key: `process:${process.id}`,
      row: {
        cpu: process.cpuPercent,
        kind: 'process',
        label: process.name,
        memory: process.memoryMB,
        pid: process.pid,
      },
    };
  };
  const roots = processes
    .filter((row) => !pids.has(row.ppid) || row.ppid === row.pid)
    .map((row) => draft(row));
  for (const row of processes) if (!seen.has(row.pid)) roots.push(draft(row));
  return roots;
};

export const buildProcessTree = ({
  activities,
  agentTitle,
  appProcesses,
  labels,
  query,
  sort,
  topicTitle,
  totalMemoryMB,
  workspaceSlug,
}: BuildTreeInput) => {
  const needle = query.trim().toLowerCase();
  const matches = (...values: (number | string | undefined)[]) =>
    !needle ||
    values.some((value) => value !== undefined && String(value).toLowerCase().includes(needle));
  const memoryLimit = Math.min(2048, totalMemoryMB * 0.15 || 2048);

  const conversations: Draft[] = groupByConversation(activities).flatMap((conversation) => {
    const { activities: topicActivities, agentId, topicId } = conversation;
    const agent = agentId && agentTitle(agentId);
    const topic = topicId ? (topicTitle(topicId) ?? labels.conversation) : labels.shared;
    const title = agent ? `${agent} / ${topic}` : topic;
    const children = topicActivities
      .filter((row) => matches(title, row.label, ...row.processes.flatMap((p) => [p.name, p.pid])))
      .map<Draft>((activity) => {
        const hot = activity.severity !== 'normal';
        return {
          children: processDrafts(activity.processes),
          key: `activity:${activity.rootId}`,
          row: {
            cpu: activity.cpuPercent,
            cpuHot: hot && (activity.cpuPercent ?? 0) >= 200,
            href: activityLocation(activity, workspaceSlug)?.href,
            kind: 'activity',
            label: activity.label ?? '',
            memory: activity.memoryMB,
            memoryHot: hot && activity.memoryMB >= memoryLimit,
            stopId: activity.rootId,
            sub:
              activity.processes.length > 1
                ? labels.processCount(activity.processes.length)
                : undefined,
          },
        };
      });
    if (children.length === 0) return [];
    return [
      {
        children,
        key: `conversation:${conversation.key}`,
        row: {
          ...sum(children.map((c) => c.row)),
          agentId,
          kind: 'conversation',
          label: title,
          topicId,
        },
      },
    ];
  });

  const apps: Draft[] = (appProcesses ?? [])
    .map((process) => appRow(process, labels))
    .filter((row) => matches(row.label, row.sub, row.pid))
    .map((row) => ({ children: [], key: `app:${row.pid}`, row }));

  const sections: Draft[] = [
    {
      children: conversations,
      key: SECTION_BACKGROUND,
      row: { ...sum(conversations.map((c) => c.row)), kind: 'section', label: labels.background },
    },
    {
      children: apps,
      key: SECTION_APP,
      row: { ...sum(apps.map((c) => c.row)), kind: 'section', label: labels.app },
    },
  ];

  const rows = new Map<string, RowModel>();
  const toNode = (draft: Draft): TreeDataNode => {
    rows.set(draft.key, draft.row);
    const children = [...draft.children].sort(
      (a, b) =>
        Number(a.row.kind === 'conversation' && !a.row.topicId) -
          Number(b.row.kind === 'conversation' && !b.row.topicId) ||
        metric(b.row, sort) - metric(a.row, sort),
    );
    return {
      children: children.length ? children.map((child) => toNode(child)) : undefined,
      key: draft.key,
      selectable: draft.row.kind !== 'section',
      title: draft.row.label,
    };
  };

  return { rows, treeData: sections.map((section) => toNode(section)) };
};
