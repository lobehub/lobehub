/** Class of the virtual list that renders a conversation's rows. */
export const VLIST_CLASS_NAME = 'conversation-vlist';

/**
 * CSS custom property (a length) a host sets on an ancestor of the list when a
 * panel floats beside it. The list's scroller extends that far past its
 * inline-end edge, underneath the panel, so its scrollbar sits on the host's
 * edge instead of in the gap between the messages and the panel. The rows keep
 * their width. Unset means no extension.
 */
export const CONVERSATION_SCROLLER_END_BLEED_VAR = '--conversation-scroller-end-bleed';

/**
 * Class of the print-only transcript mounted on `document.body` while the
 * browser prints. Global print styles hide every other body child when it is
 * present, so the paper carries the messages without the app chrome.
 */
export const CONVERSATION_PRINT_ROOT_CLASS = 'conversation-print-root';
