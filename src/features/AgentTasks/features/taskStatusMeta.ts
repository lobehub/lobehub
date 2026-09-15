import type { TaskStatus } from '@lobechat/types';
import type { LucideIcon } from 'lucide-react';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';

interface StatusMeta {
  color: string;
  icon: LucideIcon;
  label: string;
  labelKey: string;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: { ...TASK_STATUS_VISUALS.backlog, label: 'Backlog', labelKey: 'status.backlog' },
  canceled: { ...TASK_STATUS_VISUALS.canceled, label: 'Canceled', labelKey: 'status.canceled' },
  completed: { ...TASK_STATUS_VISUALS.completed, label: 'Completed', labelKey: 'status.completed' },
  failed: { ...TASK_STATUS_VISUALS.failed, label: 'Failed', labelKey: 'status.failed' },
  paused: { ...TASK_STATUS_VISUALS.paused, label: 'Pending review', labelKey: 'status.paused' },
  running: { ...TASK_STATUS_VISUALS.running, label: 'Running', labelKey: 'status.running' },
  scheduled: { ...TASK_STATUS_VISUALS.scheduled, label: 'Scheduled', labelKey: 'status.scheduled' },
};

export const USER_SELECTABLE_STATUSES: TaskStatus[] = [
  'backlog',
  'paused',
  'completed',
  'canceled',
];
