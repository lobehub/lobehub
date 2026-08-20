import { agentDisplayName } from '@lobechat/types';

/** Resolve the same visitor-facing agent label in both SSR metadata and the client header. */
export const sharedAgentDisplayName = agentDisplayName;
