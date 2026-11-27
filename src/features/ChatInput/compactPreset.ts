import { DENSITY_TOKENS, useInterfaceDensity } from '@/styles/density';

/**
 * Shared `<ChatInput/>` styling presets for compact right-side panels
 * (Page Agent Copilot, Task Manager, ...) so they stay visually aligned.
 */
const COMPACT_ACTION_BAR_CONTEXTS = {
  compact: { actionSize: DENSITY_TOKENS.compact.headerActionSmallSize },
  loose: { actionSize: DENSITY_TOKENS.loose.headerActionSmallSize },
};

export const useCompactActionBarContext = () => COMPACT_ACTION_BAR_CONTEXTS[useInterfaceDensity()];
export const COMPACT_ACTION_BAR_STYLE = { paddingLeft: 4, paddingRight: 4 };
export const COMPACT_SEND_BUTTON_PROPS = { size: 28 };
