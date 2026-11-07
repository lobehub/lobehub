export const HOME_INPUT_BODY_HEIGHT = 108;
export const HOME_INPUT_ACTION_BAR_HEIGHT = 40;
// The rich ChatInput adds a one-pixel border on both block edges.
export const HOME_INPUT_FRAME_HEIGHT = HOME_INPUT_BODY_HEIGHT + HOME_INPUT_ACTION_BAR_HEIGHT + 2;
export const HOME_INPUT_BOTTOM_PADDING = 8;
export const HOME_INPUT_RESERVED_HEIGHT = HOME_INPUT_FRAME_HEIGHT + HOME_INPUT_BOTTOM_PADDING;

/**
 * The Home composer's upload list key. Its text survives mode and agent
 * switches, so its attachments use one key rather than the per-mode, per-agent
 * context selection key.
 */
export const HOME_UPLOAD_CONTEXT_KEY = 'home';
