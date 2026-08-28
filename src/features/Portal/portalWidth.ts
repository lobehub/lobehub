import {
  CHAT_PORTAL_MAX_WIDTH,
  CHAT_PORTAL_TOOL_UI_WIDTH,
  CHAT_PORTAL_WIDE_WIDTH,
  CHAT_PORTAL_WIDTH,
} from '@/const/layoutTokens';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

/**
 * Persisted portal widths, keyed by `PortalViewType`. Each view remembers the
 * width the user dragged it to, so resizing the task detail pane no longer
 * shrinks the acceptance report the next time it opens.
 */
export type PortalWidths = Partial<Record<PortalViewType, number>>;

/**
 * Views that can't be read in the default 400px reading column: they render
 * code, tool UI, tables or nested conversations.
 */
const VIEW_MIN_WIDTH: PortalWidths = {
  [PortalViewType.Acceptance]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.AcceptanceCheck]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.AgentDetail]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.Artifact]: CHAT_PORTAL_TOOL_UI_WIDTH,
  [PortalViewType.TaskDetail]: CHAT_PORTAL_TOOL_UI_WIDTH,
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
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeViewType = (viewType?: PortalViewType | null) => viewType ?? PortalViewType.Home;

export const getPortalViewMinWidth = (viewType?: PortalViewType | null): number =>
  VIEW_MIN_WIDTH[normalizeViewType(viewType)] ?? CHAT_PORTAL_WIDTH;

interface GetPortalViewWidthParams {
  /**
   * The legacy shared `portalWidth`, used as the fallback for views that have
   * neither a remembered width nor an explicit default.
   */
  legacyWidth?: number;
  viewType?: PortalViewType | null;
  widths?: PortalWidths;
}

export const getPortalViewWidth = ({
  legacyWidth,
  viewType,
  widths,
}: GetPortalViewWidthParams): number => {
  const key = normalizeViewType(viewType);
  const fallback = VIEW_DEFAULT_WIDTH[key] ?? legacyWidth ?? CHAT_PORTAL_WIDTH;

  return clamp(widths?.[key] || fallback, getPortalViewMinWidth(key), CHAT_PORTAL_MAX_WIDTH);
};
