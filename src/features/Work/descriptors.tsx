import { classifyEditedFile, getBasename } from '@lobechat/builtin-tools/fileEditScan';
import {
  type WorkListItem,
  workProviderOfResourceType,
  type WorkSkillProvider,
  type WorkSummaryItem,
  type WorkType,
  type WorkVersionMetadata,
} from '@lobechat/types';
import { Github } from '@lobehub/icons';
import {
  ClipboardListIcon,
  FileBoxIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
  LinkIcon,
  PresentationIcon,
} from 'lucide-react';
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

/**
 * Entity-format icon per {@link classifyEditedFile} kind. `pdf` gets its own
 * glyph; everything unclassifiable falls back to the generic file-text icon.
 */
const FILE_WORK_ICONS: Record<'slides' | 'sheet' | 'doc' | 'pdf', WorkIcon> = {
  doc: FileTextIcon,
  pdf: FileTypeIcon,
  sheet: FileSpreadsheetIcon,
  slides: PresentationIcon,
};

/**
 * The per-version file identity (path / url / line deltas) lives in the version
 * metadata, which only summary rows carry (`event.metadata`); plain list rows
 * fall back to their denormalized `works` columns.
 */
const getFileWorkMetadata = (item: WorkItemOfType<'file'>): WorkVersionMetadata | undefined =>
  'event' in item ? (item.event?.metadata ?? undefined) : undefined;

/** The edited file's path — from the version metadata, else the denormalized description. */
const getFileWorkPath = (item: WorkItemOfType<'file'>): string | null =>
  getFileWorkMetadata(item)?.filePath ?? item.description?.trim() ?? null;

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
  // Entity-format file Work (pptx / xlsx / docx / pdf, …). Non-entity edits
  // never register as a Work — they surface in the in-chat "edited N files"
  // aggregate card instead. The version metadata carries the file identity
  // (path / url); plain list rows fall back to the denormalized `works` columns.
  file: {
    // Subtitle is the file path (metadata), falling back to the denormalized
    // description column for list rows without version metadata.
    getDescription: (item) => getFileWorkPath(item),
    // Pick the icon from the file's entity kind; unclassifiable paths (or a
    // path-less list row) fall back to the generic file-text glyph.
    getIcon: (item) => {
      const path = getFileWorkPath(item);
      const classified = path ? classifyEditedFile(path) : undefined;
      return classified?.category === 'entity'
        ? FILE_WORK_ICONS[classified.entityKind]
        : FileTextIcon;
    },
    getIdentifier: (item) => item.identifier,
    // Open/download the persisted file when a durable URL exists — prefer the
    // version metadata's fileUrl, else the denormalized `url` column. Gated on
    // http(s) so Electron only ever hands safe URLs to shell.openExternal.
    getOpenTarget: (item) => {
      const fileUrl = getFileWorkMetadata(item)?.fileUrl ?? item.url;
      return isSafeExternalUrl(fileUrl) ? { kind: 'external', url: fileUrl } : null;
    },
    // Title is the file name (basename of the path), falling back to the
    // denormalized title column.
    getTitle: (item) => {
      const path = getFileWorkPath(item);
      // `getBasename` returns '' for a segment-less path; fall through to the
      // denormalized title in that case (matching the previous null-coalescing).
      return (path ? getBasename(path) : '') || item.title;
    },
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
 * Generic descriptor for a Work type this client build doesn't know — a type
 * added to the server registry after this client shipped. Reads only the
 * denormalized base columns (present on every Work item) and never resolves an
 * open target, so an unfamiliar type renders as an inert generic card instead of
 * crashing. The card call sites already fall through to `resourceId` / `id` when
 * these are null.
 */
const FALLBACK_WORK_TYPE_DESCRIPTOR: WorkTypeDescriptor<WorkListItem | WorkSummaryItem> = {
  getDescription: (item) => item.description?.trim() ?? null,
  getIcon: () => FileBoxIcon,
  getIdentifier: (item) => item.identifier,
  getOpenTarget: () => null,
  getTitle: (item) => item.title,
};

/**
 * Narrowing accessor so a call site holding a `WorkListItem` / `WorkSummaryItem`
 * union keeps type safety: the returned descriptor's methods accept exactly the
 * item type passed in.
 *
 * Total by construction: an unknown `item.type` (a type the server registry
 * gained after this client shipped) resolves to {@link FALLBACK_WORK_TYPE_DESCRIPTOR}
 * rather than `undefined`. Deployed clients lag — Electron by weeks — so a Work
 * enum addition must DEGRADE, not crash: the previous partial lookup returned
 * `undefined` and the next `descriptor.getIcon(item)` threw a TypeError that took
 * down the whole works UI. The server also gates new types out of un-opted-in
 * responses (see `resolveAllowedWorkTypes`), but this is the client-side
 * belt-and-suspenders for the next type before that gating exists.
 */
export const getWorkTypeDescriptor = <Item extends WorkListItem | WorkSummaryItem>(
  item: Item,
): WorkTypeDescriptor<Item> => {
  // Look up through a widened index type: at runtime `item.type` can be a Work
  // type the server registry gained after this build shipped, so the entry may
  // genuinely be missing even though the compile-time map looks total. The
  // re-narrowing casts are safe — a registry entry keyed by `item.type` accepts
  // exactly that type's item, which `Item` is.
  const descriptors = WORK_TYPE_DESCRIPTORS as Record<
    WorkType,
    WorkTypeDescriptor<Item> | undefined
  >;
  return descriptors[item.type] ?? (FALLBACK_WORK_TYPE_DESCRIPTOR as WorkTypeDescriptor<Item>);
};
