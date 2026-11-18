import { createContext, type ReactNode } from 'react';

/**
 * Host seam for the avatar of the agent doing a task. The in-app map provides
 * the profile-card avatar (which reads the agent store); a host with no agents
 * to show — the share page — leaves it null and the card simply omits it, so
 * the map never imports the agent store on its behalf.
 */
export type RenderAssigneeAvatar = (props: { agentId: string; size: number }) => ReactNode;

export const AssigneeAvatarContext = createContext<RenderAssigneeAvatar | null>(null);
