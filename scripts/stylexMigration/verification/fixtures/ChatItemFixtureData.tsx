import type { ReactNode } from 'react';

const state = {
  selectRange: () => {},
  toggleMessageSelected: () => {},
};

const select = <T,>(selector: (value: typeof state) => T) => selector(state);

export const useConversationStore = select;
export const useAgentStore = select;
export const useGlobalStore = select;

export const contextSelectors = {
  agentId: () => undefined,
  conversationKey: () => undefined,
};
export const messageStateSelectors = {
  isMessageSelected: () => () => false,
  isSelectionMode: () => true,
};
export const builtinAgentSelectors = { webOnboardingAgentId: () => undefined };
export const systemStatusSelectors = { wideScreen: () => true };

export const isDev = false;

export const useActivityTime = () => ({ text: '2 minutes ago', title: '2026-11-05 10:00' });

const Placeholder = ({ children, message }: { children?: ReactNode; message?: ReactNode }) => (
  <div style={{ minHeight: 32, minWidth: 32 }}>
    {message}
    {children}
  </div>
);

export default Placeholder;
