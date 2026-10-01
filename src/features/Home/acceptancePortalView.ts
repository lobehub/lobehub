import { type InternalLinkReference } from '@/features/EntityLink';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

/** Portal views that Home can present without navigating away from the inbox. */
export const isAcceptancePortalView = (viewType: PortalViewType | null) =>
  viewType === PortalViewType.Acceptance || viewType === PortalViewType.AcceptanceCheck;

/**
 * Entity details the inbox can open in the acceptance drawer. Everything else —
 * a task, a goal, a document — has no panel here and follows its own route.
 */
export const HOME_ENTITY_PORTAL_SCOPE = [
  'acceptance',
] as const satisfies readonly InternalLinkReference['type'][];
