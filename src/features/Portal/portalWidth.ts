import {
  CHAT_PORTAL_CONVERSATION_MAX_WIDTH,
  CHAT_PORTAL_MAX_WIDTH,
  CHAT_PORTAL_TASK_WIDTH,
  CHAT_PORTAL_TOOL_UI_WIDTH,
  CHAT_PORTAL_WIDE_WIDTH,
  CHAT_PORTAL_WIDTH,
} from '@/const/layoutTokens';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

/**
 * Opening width for the panel when it hosts a side conversation instead of a
 * portal view (the goal page's "ask about progress" chat). Stored under its
 * own view key so a conversation's remembered width never bleeds into tool /
 * detail views, and vice versa.
 */
export const PORTAL_CONVERSATION_VIEW_TYPE = 'conversation';

/**
 * Persisted portal widths, keyed by `PortalViewType`. Each view remembers the
 * width the user dragged it to, so resizing the task detail pane no longer
 * shrinks the acceptance report the next time it opens. Side conversations
 * (`PORTAL_CONVERSATION_VIEW_TYPE`) share the same memory map.
 */
export type PortalWidths = Partial<Record<PortalViewType, number>> & Record<string, number>;

/**
 * Views that can't be read in the default 400px reading column: they render
 * code, tool UI, tables or nested conversations.
 */
const VIEW_MIN_WIDTH: PortalWidths = {
  [PortalViewType.Acceptance]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.AcceptanceCheck]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.AgentDetail]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.Artifact]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.GoalMetric]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.GoalNode]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.TaskDetail]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.TaskResult]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.Thread]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.ToolUI]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.Topic]: CHAT_PORTAL_TOOL_UI_WIDTH,
};

/**
 * Opening width for views that want more than the remembered generic width.
 * A view listed here ignores the legacy shared width, so users who had dragged
 * the portal narrow still get a readable pane the first time they open it.
 */
const VIEW_DEFAULT_WIDTH: PortalWidths = {
  [PortalViewType.Acceptance]: CHAT_PORTAL_WIDE_WIDTH,
  [PortalViewType.AcceptanceCheck]: CHAT_PORTAL_WIDE_WIDTH,
  // Task / goal-node detail pack status, instruction, sub-tasks and the
  // activity feed into one column — wider than the reading column, but the
  // full document width crowds the page it sits next to.
  [PortalViewType.GoalNode]: CHAT_PORTAL_TASK_WIDTH,
  [PortalViewType.TaskDetail]: CHAT_PORTAL_TASK_WIDTH,
  [PortalViewType.TaskResult]: CHAT_PORTAL_TASK_WIDTH,
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const CONVERSATION_MIN_WIDTH = CHAT_PORTAL_WIDTH;

/**
 * A side conversation renders in the panel when no drill-down view is open.
 * It gets its own storage key and width bounds so the conversation column can
 * never inherit — or be inflated into — a work-surface width.
 */
const isConversationViewType = (viewType?: PortalViewType | null): boolean =>
  !viewType || viewType === PortalViewType.Home;

const normalizeViewType = (viewType?: PortalViewType | null): string =>
  viewType ?? PORTAL_CONVERSATION_VIEW_TYPE;

/**
 * Surfaces that host the Portal remember widths independently: dragging the
 * task pane on the goal page must not resize the same pane in the chat
 * conversation. The chat surface (no scope) keeps the unprefixed legacy keys.
 */
export const portalWidthStorageKey = (viewType?: PortalViewType | null, scope?: string): string => {
  const key = normalizeViewType(viewType);
  return scope ? `${scope}:${key}` : key;
};

export const getPortalViewMinWidth = (viewType?: PortalViewType | null): number =>
  isConversationViewType(viewType)
    ? CONVERSATION_MIN_WIDTH
    : (VIEW_MIN_WIDTH[normalizeViewType(viewType)] ?? CHAT_PORTAL_WIDTH);

/** Drag ceiling for a view: conversations cap low, work views keep 1280. */
export const getPortalViewMaxWidth = (viewType?: PortalViewType | null): number =>
  isConversationViewType(viewType) ? CHAT_PORTAL_CONVERSATION_MAX_WIDTH : CHAT_PORTAL_MAX_WIDTH;

interface GetPortalViewWidthParams {
  /**
   * The legacy shared `portalWidth`, used as the fallback for views that have
   * neither a remembered width nor an explicit default.
   */
  legacyWidth?: number;
  /** Width-memory namespace (e.g. 'goal'); omitted for the chat surface. */
  scope?: string;
  viewType?: PortalViewType | null;
  widths?: Partial<Record<string, number>>;
}

export const getPortalViewWidth = ({
  legacyWidth,
  scope,
  viewType,
  widths,
}: GetPortalViewWidthParams): number => {
  const key = normalizeViewType(viewType);
  // A conversation never falls back to the legacy shared width: it always has
  // its own default, so an old narrow drag can't shrink it and a work view's
  // memory can't inflate it.
  const fallback = VIEW_DEFAULT_WIDTH[key] ?? legacyWidth ?? CHAT_PORTAL_WIDTH;

  return clamp(
    widths?.[portalWidthStorageKey(viewType, scope)] ||
      (isConversationViewType(viewType) ? CHAT_PORTAL_WIDTH : fallback),
    getPortalViewMinWidth(viewType),
    getPortalViewMaxWidth(viewType),
  );
};
