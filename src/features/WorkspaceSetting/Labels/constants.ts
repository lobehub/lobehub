/**
 * Preset label colors (Linear-inspired palette). Custom values are still
 * allowed through the form's free color input.
 */
export const LABEL_COLOR_PRESETS = [
  '#95999F', // gray
  '#4EA7FC', // blue
  '#26B5CE', // teal
  '#4CB782', // green
  '#F2C94C', // yellow
  '#F2994A', // orange
  '#F1573D', // red
  '#EB5A95', // pink
  '#B36BD4', // purple
  '#6771C5', // indigo
] as const;

export const DEFAULT_LABEL_COLOR = LABEL_COLOR_PRESETS[0];

/**
 * Mirrors the server's `hexColor` check. The value lands in an inline
 * `background`, so anything else is a CSS injection point — the server is the
 * gate, this only keeps the free-form input from submitting a value that is
 * bound to be rejected.
 */
export const isValidLabelColor = (value: string): boolean =>
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
