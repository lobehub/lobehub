'use client';

import { createContext, type FC, type PropsWithChildren, use } from 'react';

/**
 * Whether an ancestor layout already mounts this workspace's side panel.
 *
 * A routed page that would otherwise carry its own panel reads this and stays
 * out of the way. Two portal hosts on one surface render the same detail in
 * both panels, and the page's own content is squeezed out beside them — so a
 * link that opens a detail looks like it replaced the page it was clicked in.
 */
const WorkspaceSidePanelContext = createContext(false);

export const WorkspaceSidePanelProvider: FC<PropsWithChildren> = ({ children }) => (
  <WorkspaceSidePanelContext value={true}>{children}</WorkspaceSidePanelContext>
);

export const useWorkspaceSidePanel = () => use(WorkspaceSidePanelContext);
