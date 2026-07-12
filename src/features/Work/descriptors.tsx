import type { WorkListItem, WorkSummaryItem, WorkType } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ClipboardListIcon, FileTextIcon } from 'lucide-react';
import type { ComponentType } from 'react';

import LinearIcon from './icons/LinearIcon';

/**
 * Where opening a Work should lead. Components map this to their own action
 * (chat portal, preview modal, router navigate, `window.open`) — the descriptor
 * only names the destination, it never reaches into a store or the DOM itself.
 */
export type WorkOpenTarget =
  | { agentDocumentId?: string; documentId: string; kind: 'document' }
  | { identifier: string; kind: 'task' }
  | { kind: 'external'; url: string };

/** Narrow a Work list/summary union member to the variants of a single type. */
type WorkItemOfType<T extends WorkType> =
  Extract<WorkListItem, { type: T }> | Extract<WorkSummaryItem, { type: T }>;

interface WorkTypeDescriptor<Item extends WorkListItem | WorkSummaryItem> {
  /**
   * Summary preview text. Summary payloads slim long free-text server-side
   * (linear content / github body / task instruction capped), so prefer the
   * description, then a short body/status — never a full document.
   */
  getDescription: (item: Item) => string | null;
  /** Where a click should lead, or `null` when the Work is not clickable. */
  getOpenTarget: (item: Item) => WorkOpenTarget | null;
  /**
   * Snapshot title straight from the resource (task name is live from the tasks
   * join). No synthesized fallback here: a nameless resource deliberately falls
   * through to its bare identifier at the call site so data gaps stay visible.
   */
  getTitle: (item: Item) => string | null;
  Icon: ComponentType<{ className?: string; size?: number }>;
}

export const WORK_TYPE_DESCRIPTORS: {
  [T in WorkType]: WorkTypeDescriptor<WorkItemOfType<T>>;
} = {
  document: {
    Icon: FileTextIcon,
    getDescription: (item) => item.document.description?.trim() ?? null,
    getOpenTarget: (item) => ({
      // WorkListItem carries no `event`; only summary rows can supply the
      // agentDocumentId that scopes the chat portal's document view.
      agentDocumentId: 'event' in item ? item.event?.metadata?.agentDocumentId : undefined,
      documentId: item.document.id,
      kind: 'document',
    }),
    getTitle: (item) => item.document.title,
  },
  github: {
    Icon: Github,
    getDescription: (item) => (item.github.body || item.github.state)?.trim() ?? null,
    // Github works registered from CLI/tool results may carry no URL — those
    // cards have nothing to open, so drop the click affordance entirely.
    getOpenTarget: (item) => (item.github.url ? { kind: 'external', url: item.github.url } : null),
    getTitle: (item) => item.github.title,
  },
  linear: {
    Icon: LinearIcon,
    getDescription: (item) => (item.linear.description || item.linear.status)?.trim() ?? null,
    // Linear works registered from CLI/tool results may carry no URL — those
    // cards have nothing to open, so drop the click affordance entirely.
    getOpenTarget: (item) => (item.linear.url ? { kind: 'external', url: item.linear.url } : null),
    getTitle: (item) => item.linear.title,
  },
  task: {
    Icon: ClipboardListIcon,
    getDescription: (item) => item.task.instruction?.trim() ?? null,
    // Resolve the task detail by its human label when present, else its id — the
    // same identifier the chat portal and standalone route both accept. The
    // task-deleted orphan case is gated by the call site (it also renders a
    // badge), not stripped here.
    getOpenTarget: (item) => ({ identifier: item.resourceLabel ?? item.resourceId, kind: 'task' }),
    getTitle: (item) => item.task.name,
  },
};

/**
 * Narrowing accessor so a call site holding a `WorkListItem` / `WorkSummaryItem`
 * union keeps type safety: the returned descriptor's methods accept exactly the
 * item type passed in.
 */
export const getWorkTypeDescriptor = <Item extends WorkListItem | WorkSummaryItem>(
  item: Item,
): WorkTypeDescriptor<Item> =>
  WORK_TYPE_DESCRIPTORS[item.type] as unknown as WorkTypeDescriptor<Item>;
