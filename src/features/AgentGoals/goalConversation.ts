'use client';

import { createContext, use } from 'react';

/**
 * Bring the goal's conversation into the right panel, replacing any open
 * drill-down. Provided by the goal detail page so actions deep in the process
 * view — or in the portal it hosts — can show the owner what the agent was
 * just sent. Absent where no page owns that panel.
 */
export const GoalConversationContext = createContext<(() => void) | undefined>(undefined);

export const useOpenGoalConversation = () => use(GoalConversationContext);
