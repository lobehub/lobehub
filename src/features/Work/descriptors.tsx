import { classifyEditedFile, getBasename } from '@lobechat/builtin-tools/fileEditScan';
import {
  type ExternalWorkResourceType,
  type ListedWorkType,
  type WorkListItem,
  workProviderOfResourceType,
  type WorkSkillProvider,
  type WorkSummaryItem,
  type WorkType,
  type WorkVersionMetadata,
} from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { cssVar, FileTypeIcon as FileTypeBadge } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import {
  CircleCheckIcon,
  CircleDotIcon,
  ClipboardListIcon,
  FileBoxIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
  GitPullRequestDraftIcon,
  LinkIcon,
  PanelsTopLeftIcon,
  PresentationIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { mimeTypeMap } from '@/components/FileIcon/config';
import {
  MERGED_PURPLE,
  PR_STATE_VISUAL,
  type PullRequestStateVisual,
} from '@/features/AgentSidebar/Topic/List/Item/metaCardData';

import LinearIcon from './icons/LinearIcon';

export type WorkIcon = ComponentType<{ className?: string; size?: number }>;

/**
 * Brand icon per skill provider for the unified `external` Work type. An
 * unmapped provider (a future provider whose resource type isn't in
 * `WORK_PROVIDER_RESOURCE_TYPES` yet) falls back to a generic link glyph.
 */
const PROVIDER_ICONS: Record<WorkSkillProvider, WorkIcon> = {
  github: Github,
  linear: LinearIcon,
};

/** Bind a color at module level so `getIcon` keeps a stable component identity. */
const tintIcon = (Glyph: LucideIcon, color: string): WorkIcon => {
  const TintedIcon: WorkIcon = ({ className, size }) => (
    <Glyph className={className} color={color} size={size} />
  );
  return TintedIcon;
};

/** `topic` namespace label of a GitHub state, the tooltip of its glyph. */
export type WorkStateLabelKey = PullRequestStateVisual['labelKey'] | 'metaCard.pr.draft';

interface GithubStateVisual {
  icon: WorkIcon;
  labelKey: WorkStateLabelKey;
}

const prState = (state: keyof typeof PR_STATE_VISUAL): GithubStateVisual => ({
  icon: tintIcon(PR_STATE_VISUAL[state].icon, PR_STATE_VISUAL[state].color),
  labelKey: PR_STATE_VISUAL[state].labelKey,
});

/**
 * GitHub state glyphs, matching the topic PR card: the icon's shape and color
 * carry open / draft / merged / closed instead of a status word on the card.
 * Keys are the `status` values the github normalizer writes; any other status
 * keeps the brand icon.
 */
const GITHUB_STATES: Partial<Record<ExternalWorkResourceType, Map<string, GithubStateVisual>>> = {
  github_issue: new Map([
    [
      'closed',
      { icon: tintIcon(CircleCheckIcon, MERGED_PURPLE), labelKey: PR_STATE_VISUAL.closed.labelKey },
    ],
    [
      'open',
      {
        icon: tintIcon(CircleDotIcon, cssVar.colorSuccess),
        labelKey: PR_STATE_VISUAL.open.labelKey,
      },
    ],
  ]),
  github_pull_request: new Map([
    ['closed', prState('closed')],
    [
      'draft',
      {
        icon: tintIcon(GitPullRequestDraftIcon, cssVar.colorTextTertiary),
        labelKey: 'metaCard.pr.draft',
      },
    ],
    ['merged', prState('merged')],
    ['open', prState('open')],
  ]),
};

const getGithubState = (
  item: Pick<WorkListItem, 'resourceType' | 'status'>,
): GithubStateVisual | undefined =>
  item.status
    ? GITHUB_STATES[item.resourceType as ExternalWorkResourceType]?.get(item.status.toLowerCase())
    : undefined;

export interface WorkBranch {
  base: string | null;
  head: string;
}

/**
 * Where opening a Work should lead. Components map this to their own action
 * (chat portal, preview modal, router navigate, `window.open`) — the descriptor
 * only names the destination, it never reaches into a store or the DOM itself.
 */
export type WorkOpenTarget =
  | { agentDocumentId?: string; documentId: string; kind: 'document' }
  | { taskId: string; identifier?: string; kind: 'task'; name?: string | null }
  | { kind: 'external'; url: string }
  /**
   * In-app preview of a cloud-persisted file (the FilePreview chat portal).
   * `url` is the already-allowlisted download fallback for surfaces without a
   * chat portal (WorkGallery), so they don't recompute the file-metadata lookup.
   */
  | { fileId: string; kind: 'filePreview'; url?: string }
  | { canvasId: string; kind: 'canvas'; version?: number };

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
   * A pull request's branches, from the summary row's version metadata. Cards
   * show the head branch in place of the description; `null` for every other
   * Work and for PRs registered without a known branch.
   */
  getBranch?: (item: Item) => WorkBranch | null;
  /**
   * Summary preview text. Summary payloads slim long free-text server-side
   * (linear content / github body / task instruction capped), so prefer the
   * description, then a short body/status — never a full document.
   */
  getDescription: (item: Item) => string | null;
  /**
   * The icon for one item. Constant for document/task; the `external` type
   * resolves a GitHub state glyph when the status is known, else a
   * per-provider brand icon from the item's resourceType.
   */
  getIcon: (item: Item) => WorkIcon;
  /**
   * Short human reference (`TASK-1`, filename, `ENG-123`, `owner/repo#42`) used
   * as the card-title fallback when the resource has no title. Cards fall back
   * further to `resourceId` when this is also null.
   */
  getIdentifier: (item: Item) => string | null;
  /**
   * Brand mark drawn before the identifier on the card's second line. GitHub
   * cards spend their main icon on the issue/PR state, so the mark keeps
   * `owner/repo#n` recognizable as a GitHub repository.
   */
  getIdentifierIcon?: (item: Item) => WorkIcon | null;
  /** Where a click should lead, or `null` when the Work is not clickable. */
  getOpenTarget: (item: Item) => WorkOpenTarget | null;
  /** Label of the state `getIcon` draws, for its tooltip; `null` when the icon carries no state. */
  getStateLabelKey?: (item: Item) => WorkStateLabelKey | null;
  /**
   * Display title straight from the `works` row (task name is live from the
   * tasks join). No synthesized fallback here: a nameless resource deliberately
   * falls through to its bare identifier at the call site so data gaps stay visible.
   */
  getTitle: (item: Item) => string | null;
}

/**
 * Fallback entity-format glyph per {@link classifyEditedFile} kind, for a future
 * entity extension without a `mimeTypeMap` brand color.
 */
const FILE_WORK_ICONS: Record<'slides' | 'sheet' | 'doc' | 'pdf', WorkIcon> = {
  doc: FileTextIcon,
  pdf: FileTypeIcon,
  sheet: FileSpreadsheetIcon,
  slides: PresentationIcon,
};

/**
 * Branded file-type badge (the colored PPTX/DOCX/XLSX/PDF glyph used by the file
 * preview surfaces) for entity file Works. Cached per extension so `getIcon`
 * keeps a stable component identity across renders — an inline closure would
 * remount the icon subtree every time the card re-renders.
 */
const FILE_BADGE_ICONS = new Map<string, WorkIcon>();

const getFileBadgeIcon = (extension: string): WorkIcon | undefined => {
  const color = mimeTypeMap[extension];
  if (!color) return undefined;

  let Icon = FILE_BADGE_ICONS.get(extension);
  if (!Icon) {
    Icon = ({ className, size }) => (
      <FileTypeBadge
        className={className}
        color={color}
        filetype={extension.toUpperCase()}
        size={size}
        type={'file'}
      />
    );
    FILE_BADGE_ICONS.set(extension, Icon);
  }
  return Icon;
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
  [T in ListedWorkType]: WorkTypeDescriptor<WorkItemOfType<T>>;
} = {
  canvas: {
    getDescription: (item) => item.description?.trim() ?? null,
    getIcon: () => PanelsTopLeftIcon,
    getIdentifier: () => null,
    getOpenTarget: (item) => {
      if (!item.resourceId) return null;
      const eventVersion = 'event' in item ? item.event?.version : undefined;
      const currentVersion = 'version' in item ? item.version?.version : undefined;
      // Only an older card pins its version; the current card follows edits made after it opened.
      const pinned = eventVersion && currentVersion && eventVersion < currentVersion;
      return {
        canvasId: item.resourceId,
        kind: 'canvas',
        ...(pinned ? { version: eventVersion } : {}),
      };
    },
    getTitle: (item) => item.title,
  },
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
    // Pick the branded file-type badge from the file's extension; unclassifiable
    // paths (or a path-less list row) fall back to the generic file-text glyph.
    getIcon: (item) => {
      const path = getFileWorkPath(item);
      const classified = path ? classifyEditedFile(path) : undefined;
      if (classified?.category !== 'entity') return FileTextIcon;
      const extension = path!.split('.').pop()!.toLowerCase();
      return getFileBadgeIcon(extension) ?? FILE_WORK_ICONS[classified.entityKind];
    },
    getIdentifier: (item) => item.identifier,
    // Prefer the in-app FilePreview portal via the file-store id (summary rows
    // only — list rows carry no version metadata). Fall back to opening the
    // persisted URL when no fileId exists: prefer the version metadata's
    // fileUrl, else the denormalized `url` column. Gated on http(s) so Electron
    // only ever hands safe URLs to shell.openExternal.
    getOpenTarget: (item) => {
      const metadata = getFileWorkMetadata(item);
      const fileUrl = metadata?.fileUrl ?? item.url;
      const safeUrl = isSafeExternalUrl(fileUrl) ? fileUrl : undefined;
      if (metadata?.fileId) return { fileId: metadata.fileId, kind: 'filePreview', url: safeUrl };
      return safeUrl ? { kind: 'external', url: safeUrl } : null;
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
    getBranch: (item) => {
      if (item.resourceType !== 'github_pull_request' || !('event' in item)) return null;
      const metadata = item.event?.metadata;
      return metadata?.headBranch
        ? { base: metadata.baseBranch ?? null, head: metadata.headBranch }
        : null;
    },
    // GitHub state is drawn by the icon, so only Linear falls back to its status text.
    getDescription: (item) =>
      (workProviderOfResourceType(item.resourceType) === 'github'
        ? item.description
        : item.description || item.status
      )?.trim() ?? null,
    // A GitHub issue/PR with a known state takes its state glyph; otherwise
    // the provider's brand icon. Unknown providers fall back to a generic link
    // glyph (forward-compat).
    getIcon: (item) => {
      const provider = workProviderOfResourceType(item.resourceType);
      if (!provider) return LinkIcon;
      return getGithubState(item)?.icon ?? PROVIDER_ICONS[provider];
    },
    getIdentifier: (item) => item.identifier,
    // Every GitHub card carries the mark, including a brand-icon card with an
    // unknown state, so the identifiers line up in a list.
    getIdentifierIcon: (item) =>
      workProviderOfResourceType(item.resourceType) === 'github' ? Github : null,
    // External works registered from CLI/tool results may carry no URL (or a
    // member-planted non-http(s) scheme) — those cards have nothing safe to
    // open, so drop the click affordance entirely.
    getOpenTarget: (item) =>
      isSafeExternalUrl(item.url) ? { kind: 'external', url: item.url } : null,
    getStateLabelKey: (item) => getGithubState(item)?.labelKey ?? null,
    getTitle: (item) => item.title,
  },
  task: {
    getDescription: (item) => item.task.instruction?.trim() ?? null,
    getIcon: () => ClipboardListIcon,
    getIdentifier: (item) => item.task.identifier,
    getOpenTarget: (item) =>
      item.resourceId
        ? {
            taskId: item.resourceId,
            identifier: item.resourceDeleted ? undefined : (item.task.identifier ?? undefined),
            kind: 'task',
            name: item.task.name,
          }
        : null,
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
  const descriptors = WORK_TYPE_DESCRIPTORS as Partial<Record<WorkType, WorkTypeDescriptor<Item>>>;
  return descriptors[item.type] ?? (FALLBACK_WORK_TYPE_DESCRIPTOR as WorkTypeDescriptor<Item>);
};
