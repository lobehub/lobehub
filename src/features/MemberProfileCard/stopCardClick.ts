/**
 * A hover card renders in a portal, but React still bubbles its clicks to the
 * trigger's ancestors: without stopping them, clicking inside the card would
 * also open the assignee picker or the row the avatar sits in.
 */
export const stopCardClick = (event: { stopPropagation: () => void }) => event.stopPropagation();
