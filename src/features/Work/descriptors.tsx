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

/**
 * Client-side allowlist for external Work URLs (defense in depth over the
 * authoritative write-time `sanitizeExternalUrl` in the database package —
 * frontend code must not import that package). Work URLs are member-controlled
 * (Linear payloads, parsed `gh` stdout), so an old snapshot could still hold a
 * `javascript:`/`data:`/`file:`/custom scheme. On desktop (Electron) opening a
 * Work card runs `window.open` → `shell.openExternal`, so only ever hand off
 * http(s) URLs.
 */
export const isSafeExternalUrl = (url?: string | null): url is string => {
  if (!url) return false;

  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

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
  /**
   * Short human reference (`TASK-1`, filename, `ENG-123`, `owner/repo#42`) used
   * as the card-title fallback when the resource has no title. Cards fall back
   * further to `resourceId` when this is also null.
   */
  getIdentifier: (item: Item) => string | null;
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
    getIdentifier: (item) => item.document.identifier,
    getOpenTarget: (item) => ({
      // WorkListItem carries no `event`; only summary rows can supply the
      // agentDocumentId that scopes the chat portal's document view.
      agentDocumentId: 'event' in item ? item.event?.metadata?.agentDocumentId : undefined,
      // For `document` works the resource identity IS the document id.
      documentId: item.resourceId,
      kind: 'document',
    }),
    getTitle: (item) => item.document.title,
  },
  github: {
    Icon: Github,
    getDescription: (item) => (item.github.description || item.github.status)?.trim() ?? null,
    getIdentifier: (item) => item.github.identifier,
    // Github works registered from CLI/tool results may carry no URL (or a
    // member-planted non-http(s) scheme) — those cards have nothing safe to
    // open, so drop the click affordance entirely.
    getOpenTarget: (item) =>
      isSafeExternalUrl(item.github.url) ? { kind: 'external', url: item.github.url } : null,
    getTitle: (item) => item.github.title,
  },
  linear: {
    Icon: LinearIcon,
    getDescription: (item) => (item.linear.description || item.linear.status)?.trim() ?? null,
    getIdentifier: (item) => item.linear.identifier,
    // Linear works registered from CLI/tool results may carry no URL (or a
    // member-planted non-http(s) scheme) — those cards have nothing safe to
    // open, so drop the click affordance entirely.
    getOpenTarget: (item) =>
      isSafeExternalUrl(item.linear.url) ? { kind: 'external', url: item.linear.url } : null,
    getTitle: (item) => item.linear.title,
  },
  task: {
    Icon: ClipboardListIcon,
    getDescription: (item) => item.task.instruction?.trim() ?? null,
    getIdentifier: (item) => item.task.identifier,
    // Resolve the task detail by its human identifier (`TASK-1`, live-coalesced
    // with the snapshot) when present, else its id — the same identifier the
    // chat portal and standalone route both accept. The task-deleted orphan case
    // is gated by the call site (it also renders a badge), not stripped here.
    getOpenTarget: (item) => ({
      identifier: item.task.identifier ?? item.resourceId,
      kind: 'task',
    }),
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
