import type {
  GlobalState,
  ModelDetailPanelExpandedKey,
  SystemStatus,
  WorkspaceOverridableField,
} from '../initialState';
import {
  DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS,
  DEFAULT_MODEL_DETAIL_PANEL_EXPANDED_KEYS,
  INITIAL_STATUS,
  WORKSPACE_OVERRIDABLE_FIELDS,
} from '../initialState';

/**
 * Read a workspace-overridable field from SystemStatus.
 * When `workspaceId` is non-null and the overlay carries the field, returns the overlay
 * value; otherwise falls back to the top-level (personal mode) value.
 */
export const readOverridableField = <K extends WorkspaceOverridableField>(
  status: SystemStatus,
  field: K,
  workspaceId: string | null,
): SystemStatus[K] => {
  if (workspaceId) {
    const overlay = status.workspace?.[field];
    if (overlay !== undefined) return overlay as SystemStatus[K];
  }
  return status[field];
};

const OVERRIDABLE_SET = new Set<string>(WORKSPACE_OVERRIDABLE_FIELDS);

/**
 * Reshape an `updateSystemStatus` patch when the user is inside a workspace:
 * whitelisted fields land in `workspace.*` so they do not bleed into personal
 * mode. Non-whitelisted fields stay at the top level. An explicit `workspace`
 * key in the patch is preserved and merged with the routed overlay.
 *
 * Pass `workspaceId = null` to bypass routing (init path, personal mode).
 */
export const routeOverlayWrites = (
  patch: Partial<SystemStatus>,
  workspaceId: string | null,
): Partial<SystemStatus> => {
  if (!workspaceId) return patch;

  const { workspace: explicitOverlay, ...rest } = patch;
  const overlayUpdates: Partial<Pick<SystemStatus, WorkspaceOverridableField>> = {};
  const topLevel: Partial<SystemStatus> = {};

  for (const key of Object.keys(rest)) {
    if (OVERRIDABLE_SET.has(key)) {
      (overlayUpdates as any)[key] = (rest as any)[key];
    } else {
      (topLevel as any)[key] = (rest as any)[key];
    }
  }

  const overlay = { ...explicitOverlay, ...overlayUpdates };
  return Object.keys(overlay).length > 0 ? { ...topLevel, workspace: overlay } : topLevel;
};

export const systemStatus = (s: GlobalState) => s.status;

export const NAV_PANEL_MIN_WIDTH = 240;
export const NAV_PANEL_MAX_WIDTH = 400;

const normalizeNavPanelWidth = (width: number | string | undefined): number => {
  const parsed = typeof width === 'string' ? Number.parseInt(width) : width;
  const fallback = INITIAL_STATUS.leftPanelWidth;

  if (!parsed || !Number.isFinite(parsed)) return fallback;

  return Math.min(NAV_PANEL_MAX_WIDTH, Math.max(NAV_PANEL_MIN_WIDTH, parsed));
};

const agentBuilderPanelWidth = (s: GlobalState) => s.status.agentBuilderPanelWidth || 360;

const sessionGroupKeys =
  (workspaceId: string | null) =>
  (s: GlobalState): string[] => {
    const value = readOverridableField(s.status, 'expandSessionGroupKeys', workspaceId);
    return value || INITIAL_STATUS.expandSessionGroupKeys;
  };

const topicGroupKeys = (s: GlobalState): string[] | undefined => s.status.expandTopicGroupKeys;

const agentSidebarSections =
  (agentId: string | undefined) =>
  (s: GlobalState): Record<string, boolean> | undefined =>
    agentId ? s.status.expandAgentSidebarSectionsByAgent?.[agentId] : undefined;

const topicPageSize = (s: GlobalState): number => s.status.topicPageSize || 20;

const agentPageSize = (s: GlobalState): number => s.status.agentPageSize || 5;

const privateAgentPageSize = (s: GlobalState): number => s.status.privateAgentPageSize || 5;

const recentPageSize = (s: GlobalState): number => s.status.recentPageSize || 5;

const pagePageSize = (s: GlobalState): number => s.status.pagePageSize || 20;
const taskListViewOptions = (s: GlobalState) =>
  s.status.taskListViewOptions || {
    groupBy: 'status',
    hideCompleted: true,
    orderBy: 'updatedAt',
    orderCompletedByRecency: true,
    orderDirection: 'asc',
    subGroupBy: 'none',
  };

const taskCreateInlineCollapsed = (s: GlobalState): boolean =>
  s.status.taskCreateInlineCollapsed ?? false;

export const DEFAULT_KANBAN_HIDDEN_COLUMNS: string[] = ['done', 'canceled'];

const taskKanbanHiddenColumns = (s: GlobalState): string[] =>
  s.status.taskKanbanHiddenColumns ?? DEFAULT_KANBAN_HIDDEN_COLUMNS;

const taskKanbanHiddenPanelCollapsed = (s: GlobalState): boolean =>
  s.status.taskKanbanHiddenPanelCollapsed ?? false;

export const DEFAULT_HIDDEN_SECTIONS: string[] = [];

/** Sections hidden by default in workspace mode until the user customizes
 * sidebar visibility. `recents` lives in personal mode where the catch-all
 * stream is useful, but in a workspace the agent/project lists are the
 * primary entry points — surfacing recents on top adds noise. */
export const WORKSPACE_DEFAULT_HIDDEN_SECTIONS: string[] = ['recents'];

/** Sections hidden by default for the given mode. The customize-sidebar
 * "Reset to default" path uses this so resetting in a workspace restores
 * the workspace defaults, not the empty personal-mode defaults. */
export const getDefaultHiddenSections = (isWorkspaceMode: boolean): string[] =>
  isWorkspaceMode ? [...WORKSPACE_DEFAULT_HIDDEN_SECTIONS] : DEFAULT_HIDDEN_SECTIONS;

const hiddenSidebarSections =
  (workspaceId: string | null) =>
  (s: GlobalState): string[] => {
    if (workspaceId) {
      const overlay = s.status.workspace?.hiddenSidebarSections;
      // Once the user touches sidebar visibility in this workspace the overlay
      // owns the list — including an explicit empty array meaning "show all".
      if (overlay !== undefined) return overlay;
      // Untouched workspace: inherit any personal-mode hides and layer the
      // workspace defaults on top so `recents` starts collapsed.
      const personal = s.status.hiddenSidebarSections ?? DEFAULT_HIDDEN_SECTIONS;
      const merged = [...personal];
      for (const k of WORKSPACE_DEFAULT_HIDDEN_SECTIONS) {
        if (!merged.includes(k)) merged.push(k);
      }
      return merged;
    }
    return s.status.hiddenSidebarSections ?? DEFAULT_HIDDEN_SECTIONS;
  };

const sidebarExpandedKeys =
  (workspaceId: string | null) =>
  (s: GlobalState): string[] =>
    readOverridableField(s.status, 'sidebarExpandedKeys', workspaceId) ??
    DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS;

/** Sentinel id representing the flex spacer slot. Its position in `sidebarItems`
 * determines where the sidebar pushes items to the bottom. */
export const SIDEBAR_SPACER_ID = '__spacer__';

export const DEFAULT_SIDEBAR_ITEMS: string[] = [
  'tasks',
  'pages',
  'recents',
  'private',
  'agent',
  SIDEBAR_SPACER_ID,
  'image',
  'community',
  'resource',
  'memory',
];

/** Items that must stay contiguous in the sidebar list (accordion block).
 * `private` sits above `agent` so workspace users see their personal items
 * first, with the workspace-shared agents right below. */
export const SIDEBAR_ACCORDION_KEYS = new Set(['recents', 'private', 'agent']);

const DEFAULT_BOTTOM_KEYS = new Set(
  DEFAULT_SIDEBAR_ITEMS.slice(DEFAULT_SIDEBAR_ITEMS.indexOf(SIDEBAR_SPACER_ID) + 1),
);

const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// Invariant: spacer always sits immediately after the recents+agent block. Any
// stored position is ignored — the spacer is re-anchored on every read so legacy
// states (e.g. from the move-up/down dropdown that used to leave the spacer
// floating above the accordion) self-heal.
const normalizeSpacerPosition = (order: string[]): string[] => {
  const withoutSpacer = order.filter((k) => k !== SIDEBAR_SPACER_ID);

  let insertAt = -1;
  for (let i = withoutSpacer.length - 1; i >= 0; i--) {
    if (SIDEBAR_ACCORDION_KEYS.has(withoutSpacer[i])) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt === -1) {
    const bottomIdx = withoutSpacer.findIndex((k) => DEFAULT_BOTTOM_KEYS.has(k));
    insertAt = bottomIdx === -1 ? withoutSpacer.length : bottomIdx;
  }

  return [...withoutSpacer.slice(0, insertAt), SIDEBAR_SPACER_ID, ...withoutSpacer.slice(insertAt)];
};

// Backfill missing default keys into their canonical group — top-group defaults
// slot in just before the accordion (keeping accordion flush with the spacer),
// bottom-group defaults go after the spacer. Without this split a new top-group
// default added in a future version would silently appear in the bottom group
// for existing users.
const withAllKnownKeys = (order: string[]): string[] => {
  const present = new Set(order);
  const missingTop: string[] = [];
  const missingBottom: string[] = [];
  for (const k of DEFAULT_SIDEBAR_ITEMS) {
    if (k === SIDEBAR_SPACER_ID || present.has(k)) continue;
    (DEFAULT_BOTTOM_KEYS.has(k) ? missingBottom : missingTop).push(k);
  }

  const withSpacer = normalizeSpacerPosition(order);
  if (missingTop.length === 0 && missingBottom.length === 0) return withSpacer;

  const spacerIdx = withSpacer.indexOf(SIDEBAR_SPACER_ID);
  let accordionStartIdx = spacerIdx;
  for (let i = 0; i < spacerIdx; i++) {
    if (SIDEBAR_ACCORDION_KEYS.has(withSpacer[i])) {
      accordionStartIdx = i;
      break;
    }
  }

  return [
    ...withSpacer.slice(0, accordionStartIdx),
    ...missingTop,
    ...withSpacer.slice(accordionStartIdx, spacerIdx + 1),
    ...missingBottom,
    ...withSpacer.slice(spacerIdx + 1),
  ];
};

const accordionIndices = (items: string[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (SIDEBAR_ACCORDION_KEYS.has(items[i])) out.push(i);
  }
  return out;
};

const reorderInner = (items: string[], from: number, to: number): string[] => {
  const key = items[from];
  const accIdx = accordionIndices(items);

  // Moving an accordion item across the block's outer boundary → move whole block together.
  if (SIDEBAR_ACCORDION_KEYS.has(key) && accIdx.length >= 2) {
    const first = accIdx[0];
    const last = accIdx.at(-1)!;
    const crossesBoundary = (from === first && to < first) || (from === last && to > last);
    if (crossesBoundary) {
      const block = items.slice(first, last + 1);
      const without = [...items.slice(0, first), ...items.slice(last + 1)];
      // After removing the block, adjust target index for upward/downward movement
      const targetIdx = to < first ? to : to - (last - first + 1) + 1;
      const clamped = Math.max(0, Math.min(without.length, targetIdx));
      return [...without.slice(0, clamped), ...block, ...without.slice(clamped)];
    }
  }

  // Standard reorder
  const moved = [...items];
  const [removed] = moved.splice(from, 1);
  moved.splice(to, 0, removed);

  // Non-accordion item that landed between accordion items → snap to the side matching drag direction.
  if (!SIDEBAR_ACCORDION_KEYS.has(key)) {
    const nextAcc = accordionIndices(moved);
    if (nextAcc.length >= 2) {
      const first = nextAcc[0];
      const last = nextAcc.at(-1)!;
      const contiguous = last - first === nextAcc.length - 1;
      if (!contiguous) {
        const pos = moved.indexOf(key);
        if (pos > first && pos < last) {
          const cleaned = [...moved];
          cleaned.splice(pos, 1);
          const cAcc = accordionIndices(cleaned);
          const insertAt = from < to ? cAcc.at(-1)! + 1 : cAcc[0];
          cleaned.splice(insertAt, 0, key);
          return cleaned;
        }
      }
    }
  }

  return moved;
};

/**
 * Reorder sidebar items while keeping the accordion block (recents + agent) contiguous
 * and the spacer immediately after the accordion block. Returns the original `items`
 * reference when the move resolves to a no-op (e.g. dragging the accordion past the
 * spacer, which the invariant snaps right back), so callers can short-circuit on
 * reference equality.
 */
export const reorderSidebarItems = (items: string[], from: number, to: number): string[] => {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const normalized = normalizeSpacerPosition(reorderInner(items, from, to));
  return arraysEqual(normalized, items) ? items : normalized;
};

const sidebarItems =
  (workspaceId: string | null) =>
  (s: GlobalState): string[] => {
    const items = readOverridableField(s.status, 'sidebarItems', workspaceId);
    if (items && items.length > 0) return withAllKnownKeys(items);

    // Migrate from the legacy `sidebarSectionOrder` (canary) which only stored the
    // accordion order (e.g. ['agent', 'recents']). Apply that order to the accordion
    // slot inside the default list so users keep their custom accordion arrangement.
    const legacy = s.status.sidebarSectionOrder;
    if (legacy && legacy.length > 0) {
      const legacyAcc = legacy.filter((k) => SIDEBAR_ACCORDION_KEYS.has(k));
      if (legacyAcc.length > 0) {
        const seen = new Set<string>();
        const merged: string[] = [];
        for (const k of DEFAULT_SIDEBAR_ITEMS) {
          if (SIDEBAR_ACCORDION_KEYS.has(k)) {
            for (const lk of legacyAcc) {
              if (!seen.has(lk)) {
                merged.push(lk);
                seen.add(lk);
              }
            }
          } else if (!seen.has(k)) {
            merged.push(k);
            seen.add(k);
          }
        }
        return withAllKnownKeys(merged);
      }
    }

    return DEFAULT_SIDEBAR_ITEMS;
  };
const showSystemRole = (s: GlobalState) => s.status.showSystemRole;
const mobileShowTopic = (s: GlobalState) => s.status.mobileShowTopic;
const mobileShowPortal = (s: GlobalState) => s.status.mobileShowPortal;
const showAgentBuilderPanel = (s: GlobalState) => s.status.showAgentBuilderPanel;
const showRightPanel = (s: GlobalState) => s.status.showRightPanel;
const showLeftPanel = (s: GlobalState) => s.status.showLeftPanel;
const showPageAgentPanel = (s: GlobalState) => s.status.showPageAgentPanel;
const showTaskAgentPanel = (s: GlobalState) => s.status.showTaskAgentPanel;
const showFilePanel = (s: GlobalState) => s.status.showFilePanel;
const showVerifyReportPanel = (s: GlobalState) => s.status.showVerifyReportPanel ?? true;
const showImagePanel = (s: GlobalState) => s.status.showImagePanel;
const showImageTopicPanel = (s: GlobalState) => s.status.showImageTopicPanel;
const hidePWAInstaller = (s: GlobalState) => s.status.hidePWAInstaller;
const isShowCredit = (s: GlobalState) => s.status.isShowCredit;
const language = (s: GlobalState) => s.status.language || 'auto';
const modelDetailPanelExpandedKeys = (s: GlobalState): ModelDetailPanelExpandedKey[] =>
  s.status.modelDetailPanelExpandedKeys ?? [...DEFAULT_MODEL_DETAIL_PANEL_EXPANDED_KEYS];
const modelSwitchPanelGroupMode = (s: GlobalState) =>
  s.status.modelSwitchPanelGroupMode || 'byProvider';
const modelSwitchPanelWidth = (s: GlobalState) => s.status.modelSwitchPanelWidth || 460;
const pageAgentPanelWidth = (s: GlobalState) => s.status.pageAgentPanelWidth || 360;

const leftPanelWidth = (s: GlobalState): number => {
  return normalizeNavPanelWidth(s.status.leftPanelWidth);
};
const portalWidth = (s: GlobalState) => s.status.portalWidth || 400;
const filePanelWidth = (s: GlobalState) => s.status.filePanelWidth;
const groupAgentBuilderPanelWidth = (s: GlobalState) => s.status.groupAgentBuilderPanelWidth || 360;
const imagePanelWidth = (s: GlobalState) => s.status.imagePanelWidth;
const imageTopicViewMode = (s: GlobalState) => s.status.imageTopicViewMode || 'grid';
const imageTopicPanelWidth = (s: GlobalState) => s.status.imageTopicPanelWidth;
const verifyReportPanelWidth = (s: GlobalState) => s.status.verifyReportPanelWidth || 300;
const videoPanelWidth = (s: GlobalState) => s.status.videoPanelWidth;
const videoTopicViewMode = (s: GlobalState) => s.status.videoTopicViewMode || 'grid';
const videoTopicPanelWidth = (s: GlobalState) => s.status.videoTopicPanelWidth;
const showVideoPanel = (s: GlobalState) => s.status.showVideoPanel;
const showVideoTopicPanel = (s: GlobalState) => s.status.showVideoTopicPanel;
const wideScreen = (s: GlobalState) => !s.status.noWideScreen;
const chatInputHeight = (s: GlobalState) => s.status.chatInputHeight || 64;
const expandInputActionbar = (s: GlobalState) => s.status.expandInputActionbar;
const isStatusInit = (s: GlobalState) => !!s.isStatusInit;

const getAgentSystemRoleExpanded =
  (agentId: string) =>
  (s: GlobalState): boolean => {
    const map = s.status.systemRoleExpandedMap || {};
    return map[agentId] === true; // System role is collapsed by default
  };

const disabledModelProvidersSortType = (s: GlobalState) =>
  s.status.disabledModelProvidersSortType || 'default';
const disabledModelsSortType = (s: GlobalState) => s.status.disabledModelsSortType || 'default';

const isNotificationRead =
  (slug: string) =>
  (s: GlobalState): boolean => {
    const slugs = s.status.readNotificationSlugs || [];
    return slugs.includes(slug);
  };

const isBannerDismissed =
  (bannerId: string) =>
  (s: GlobalState): boolean => {
    const ids = s.status.dismissedBannerIds || [];
    return ids.includes(bannerId);
  };
const tokenDisplayFormatShort = (s: GlobalState) =>
  s.status.tokenDisplayFormatShort !== undefined ? s.status.tokenDisplayFormatShort : true;

const homeSelectedAgentId = (s: GlobalState) => s.status.homeSelectedAgentId;

export const systemStatusSelectors = {
  agentBuilderPanelWidth,
  agentPageSize,
  chatInputHeight,
  disabledModelProvidersSortType,
  disabledModelsSortType,
  expandInputActionbar,
  filePanelWidth,
  getAgentSystemRoleExpanded,
  groupAgentBuilderPanelWidth,
  hiddenSidebarSections,
  hidePWAInstaller,
  homeSelectedAgentId,
  imagePanelWidth,
  imageTopicViewMode,
  imageTopicPanelWidth,
  isBannerDismissed,
  isNotificationRead,
  isShowCredit,
  isStatusInit,
  language,
  leftPanelWidth,
  mobileShowPortal,
  mobileShowTopic,
  modelDetailPanelExpandedKeys,
  modelSwitchPanelGroupMode,
  modelSwitchPanelWidth,
  pageAgentPanelWidth,
  pagePageSize,
  portalWidth,
  privateAgentPageSize,
  recentPageSize,
  taskCreateInlineCollapsed,
  taskKanbanHiddenColumns,
  taskKanbanHiddenPanelCollapsed,
  taskListViewOptions,
  sidebarExpandedKeys,
  agentSidebarSections,
  sidebarItems,
  sessionGroupKeys,
  showAgentBuilderPanel,
  showFilePanel,
  showImagePanel,
  showImageTopicPanel,
  showLeftPanel,
  showPageAgentPanel,
  showRightPanel,
  showSystemRole,
  showTaskAgentPanel,
  showVerifyReportPanel,
  showVideoPanel,
  showVideoTopicPanel,
  systemStatus,
  verifyReportPanelWidth,
  tokenDisplayFormatShort,
  topicGroupKeys,
  topicPageSize,
  videoPanelWidth,
  videoTopicViewMode,
  videoTopicPanelWidth,
  wideScreen,
};
