/** Animated dots already convey activity; do not duplicate them in translated text. */
export const activityLabel = (label: string) => label.replace(/(?:…|\.{3})+\s*$/u, '');
