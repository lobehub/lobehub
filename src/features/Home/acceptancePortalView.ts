import { PortalViewType } from '@/store/chat/slices/portal/initialState';

/** Portal views that Home can present without navigating away from the inbox. */
export const isAcceptancePortalView = (viewType: PortalViewType | null) =>
  viewType === PortalViewType.Acceptance || viewType === PortalViewType.AcceptanceCheck;
