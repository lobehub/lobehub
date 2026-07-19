import {
  type WorkListItem,
  workProviderOfResourceType,
  type WorkSkillProvider,
  type WorkSummaryItem,
  type WorkType,
} from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ClipboardListIcon, FileTextIcon, LinkIcon } from 'lucide-react';
import type { ComponentType } from 'react';

import LinearIcon from './icons/LinearIcon';

type WorkIcon = ComponentType<{ className?: string; size?: number }>;

/**
 * Brand icon per skill provider for the unified `external` Work type. An
 * unmapped provider (a future provider whose resource type isn't in
 * `WORK_PROVIDER_RESOURCE_TYPES` yet) falls back to a generic link glyph.
 */
const PROVIDER_ICONS: Record<WorkSkillProvider, WorkIcon> = {
  github: Github,
  linear: LinearIcon,
};

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
   * The icon for one item. Constant for document/task; the `external` type
   * resolves a per-provider brand icon from the item's resourceType.
   */
  getIcon: (item: Item) => WorkIcon;
  /**
   * Short human reference (`TASK-1`, filename, `ENG-123`, `owner/repo#42`) used
   * as the card-title fallback when the resource has no title. Cards fall back
   * further to `resourceId` when this is also null.
   */
  getIdentifier: (item: Item) => string | null;
  /** Where a click should lead, or `null` when the Work is not clickable. */
  getOpenTarget: (item: Item) => WorkOpenTarget | null;
  /**
   * Display title straight from the `works` row (task name is live from the
   * tasks join). No synthesized fallback here: a nameless resource deliberately
   * falls through to its bare identifier at the call site so data gaps stay visible.
   */
  getTitle: (item: Item) => string | null;
}

export const WORK_TYPE_DESCRIPTORS: {
  [T in WorkType]: WorkTypeDescriptor<WorkItemOfType<T>>;
} = {
  document: {
    getDescription: (item) => item.description?.trim() ?? null,
    getIcon: () => FileTextIcon,
    getIdentifier: (item) => item.identifier,
    getOpenTarget: (item) =>
      // For `document` works the resource identity IS the document id; a Work
      // with no backing resource (nullable resourceId) has nothing to open.
      item.resourceId
        ? {
            // WorkListItem carries no `event`; only summary rows can supply the
            // agentDocumentId that scopes the chat portal's document view.
            agentDocumentId: 'event' in item ? item.event?.metadata?.agentDocumentId : undefined,
            documentId: item.resourceId,
            kind: 'document',
          }
        : null,
    getTitle: (item) => item.title,
  },
  external: {
    getDescription: (item) => (item.description || item.status)?.trim() ?? null,
    // Resolve the brand icon from the item's provider; unknown providers fall
    // back to a generic link glyph (forward-compat).
    getIcon: (item) => {
      const provider = workProviderOfResourceType(item.resourceType);
      return provider ? PROVIDER_ICONS[provider] : LinkIcon;
    },
    getIdentifier: (item) => item.identifier,
    // External works registered from CLI/tool results may carry no URL (or a
    // member-planted non-http(s) scheme) — those cards have nothing safe to
    // open, so drop the click affordance entirely.
    getOpenTarget: (item) =>
      isSafeExternalUrl(item.url) ? { kind: 'external', url: item.url } : null,
    getTitle: (item) => item.title,
  },
  task: {
    getDescription: (item) => item.task.instruction?.trim() ?? null,
    getIcon: () => ClipboardListIcon,
    getIdentifier: (item) => item.task.identifier,
    // Resolve the task detail by its human identifier (`TASK-1`, live-coalesced
    // with the persisted works column) when present, else its id — the same
    // identifier the chat portal and standalone route both accept. The
    // task-deleted orphan case is gated by the call site (it also renders a
    // badge), not stripped here. A task Work always has a resourceId, but it is
    // nullable on the base type, so drop the affordance when both are missing.
    getOpenTarget: (item) => {
      const identifier = item.task.identifier ?? item.resourceId;
      return identifier ? { identifier, kind: 'task' } : null;
    },
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
