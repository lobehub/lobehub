/**
 * Data attribute selectors for message action bar portals
 */
export const MESSAGE_ACTION_BAR_PORTAL_SELECTORS = {
  assistant: '[data-assitant-action-bar-portal]',
  assistantGroup: '[data-assistant-group-action-bar-portal]',
  user: '[data-user-action-bar-portal]',
} as const;

/**
 * Data attribute values for message action bar portals
 */
export const MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES = {
  assistant: 'data-assitant-action-bar-portal',
  assistantGroup: 'data-assistant-group-action-bar-portal',
  user: 'data-user-action-bar-portal',
} as const;
