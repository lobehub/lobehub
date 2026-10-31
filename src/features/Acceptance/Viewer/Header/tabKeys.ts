/** Every face the acceptance page can show; `?tab=<key>` may name any of them. */
export const ACCEPTANCE_TAB_KEYS = ['checks', 'discussion', 'resources', 'flow', 'frames'] as const;

export type AcceptanceTabKey = (typeof ACCEPTANCE_TAB_KEYS)[number];
