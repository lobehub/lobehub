import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@lobechat/types';

export type WebhookEventGroupKey = 'files' | 'messages' | 'runs' | 'tasks';

export interface WebhookEventGroup {
  events: WebhookEventType[];
  key: WebhookEventGroupKey;
}

/** How the subscription picker groups the event catalog. */
export const WEBHOOK_EVENT_GROUPS: WebhookEventGroup[] = [
  {
    events: ['run.started', 'run.completed', 'run.failed', 'run.intervention_requested'],
    key: 'runs',
  },
  { events: ['message.created', 'topic.created'], key: 'messages' },
  { events: ['task.status_changed', 'goal.status_changed'], key: 'tasks' },
  { events: ['file.parsed', 'notification.created'], key: 'files' },
];

export type GroupSelection = 'all' | 'none' | 'some';

export const groupSelection = (
  group: WebhookEventGroup,
  selected: readonly WebhookEventType[],
): GroupSelection => {
  const count = group.events.filter((event) => selected.includes(event)).length;
  if (count === 0) return 'none';
  return count === group.events.length ? 'all' : 'some';
};

/**
 * Checking a group selects all of its events; unchecking (or a partly checked
 * group) clears them. The result keeps the catalog order so the saved list is
 * stable whatever order the person clicked in.
 */
export const toggleGroup = (
  group: WebhookEventGroup,
  selected: readonly WebhookEventType[],
  checked: boolean,
): WebhookEventType[] => {
  const next = new Set(selected);
  for (const event of group.events) {
    if (checked) next.add(event);
    else next.delete(event);
  }
  return WEBHOOK_EVENT_TYPES.filter((event) => next.has(event));
};

export const toggleEvent = (
  event: WebhookEventType,
  selected: readonly WebhookEventType[],
  checked: boolean,
): WebhookEventType[] => {
  const next = new Set(selected);
  if (checked) next.add(event);
  else next.delete(event);
  return WEBHOOK_EVENT_TYPES.filter((item) => next.has(item));
};
